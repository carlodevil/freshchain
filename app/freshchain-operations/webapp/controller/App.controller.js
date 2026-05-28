sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("freshchain.operations.controller.App", {
    onInit: function () {
      this.loadOperations();
    },

    readList: async function (sPath, mParameters) {
      const oBinding = this.getView().getModel().bindList(sPath, undefined, undefined, undefined, mParameters);
      const aContexts = await oBinding.requestContexts(0, 100);
      return aContexts.map((oContext) => oContext.getObject());
    },

    executeAlertAction: async function (sActionName, mParameters) {
      const sAlertId = this.getView().getModel("operations").getProperty("/selectedAlertId");
      if (!sAlertId) {
        MessageToast.show("Select an alert first.");
        return;
      }

      const oAction = this.getView().getModel().bindContext(
        `/Alerts(ID=${sAlertId})/CatalogService.${sActionName}(...)`
      );
      Object.entries(mParameters || {}).forEach(([sName, vValue]) => oAction.setParameter(sName, vValue));
      await oAction.execute();
      MessageToast.show(`Alert ${sActionName} completed.`);
      await this.loadOperations();
    },

    loadOperations: async function () {
      const oModel = this.getView().getModel("operations");
      oModel.setProperty("/loading", true);

      try {
        const [aAlerts, aActions] = await Promise.all([
          this.readList("/Alerts", {
            $select: "ID,severity,status,alertType,title,recommendation,assignedTo,source,createdAt,modifiedAt",
            $orderby: "modifiedAt desc"
          }),
          this.readList("/AlertActions", {
            $select: "ID,actionType,performedBy,assignedTo,comment,previousStatus,newStatus,outcome,completedAt",
            $orderby: "completedAt desc"
          })
        ]);

        oModel.setData({
          loading: false,
          selectedAlertId: oModel.getProperty("/selectedAlertId"),
          summary: {
            open: aAlerts.filter((oAlert) => oAlert.status === "OPEN").length,
            critical: aAlerts.filter((oAlert) => oAlert.severity === "CRITICAL").length,
            acknowledged: aAlerts.filter((oAlert) => oAlert.status === "ACKNOWLEDGED").length,
            resolved: aAlerts.filter((oAlert) => oAlert.status === "RESOLVED").length
          },
          alerts: aAlerts,
          actions: aActions
        });
      } catch (oError) {
        oModel.setProperty("/loading", false);
        MessageBox.error("Operations data is unavailable. The cockpit is still usable once the backend is online.", {
          details: oError.message
        });
      }
    },

    onSelectionChange: function (oEvent) {
      const oItem = oEvent.getParameter("listItem");
      const oContext = oItem && oItem.getBindingContext("operations");
      this.getView().getModel("operations").setProperty(
        "/selectedAlertId",
        oContext ? oContext.getProperty("ID") : null
      );
    },

    onAcknowledge: function () {
      this.executeAlertAction("acknowledge", { comment: "Acknowledged from FreshChain Operations cockpit." });
    },

    onResolve: function () {
      this.executeAlertAction("resolve", {
        outcome: "Resolved after operations review.",
        comment: "Closed from FreshChain Operations cockpit."
      });
    },

    onReopen: function () {
      this.executeAlertAction("reopen", { comment: "Reopened from FreshChain Operations cockpit." });
    },

    onScrollToSection: function (oEvent) {
      const sTarget = oEvent.getSource().data("target");
      const oSection = sTarget && this.byId(sTarget);
      const oDomRef = oSection && oSection.getDomRef();
      if (oDomRef) {
        this.scrollDomRefIntoView(oDomRef);
      }
    },

    scrollDomRefIntoView: function (oDomRef) {
      let oScroller = oDomRef.parentElement;
      while (oScroller && oScroller !== document.body && oScroller.scrollHeight <= oScroller.clientHeight) {
        oScroller = oScroller.parentElement;
      }
      if (oScroller && oScroller !== document.body) {
        const iTargetTop = oScroller.scrollTop + oDomRef.getBoundingClientRect().top - oScroller.getBoundingClientRect().top - 16;
        oScroller.scrollTo({ top: iTargetTop, behavior: "smooth" });
      } else {
        oDomRef.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },

    severityState: function (sSeverity) {
      return {
        CRITICAL: "Error",
        HIGH: "Warning",
        MEDIUM: "Information",
        LOW: "Success"
      }[sSeverity] || "None";
    },

    statusState: function (sStatus) {
      return {
        OPEN: "Error",
        ASSIGNED: "Warning",
        ACKNOWLEDGED: "Information",
        RESOLVED: "Success"
      }[sStatus] || "None";
    },

    hasSelectedAlert: function (sAlertId) {
      return Boolean(sAlertId);
    }
  });
});
