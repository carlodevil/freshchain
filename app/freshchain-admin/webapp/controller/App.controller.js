sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageToast"], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("freshchain.admin.controller.App", {
    onInit: function () {
      this.loadAdmin();
    },

    readList: async function (path, count) {
      const binding = this.getView().getModel().bindList("/" + path);
      const contexts = await binding.requestContexts(0, count || 30);
      return contexts.map(function (context) {
        return context.getObject();
      });
    },

    executeAction: async function (name, parameters) {
      const binding = this.getView().getModel().bindContext("/" + name + "(...)");
      Object.keys(parameters || {}).forEach(function (key) {
        binding.setParameter(key, parameters[key]);
      });
      await binding.execute();
      return binding.getBoundContext().requestObject();
    },

    loadAdmin: async function () {
      const model = this.getOwnerComponent().getModel("admin");
      model.setProperty("/loading", true);
      try {
        const results = await Promise.all([
          this.readList("ThresholdConfigs", 50),
          this.readList("IngestionErrors", 50)
        ]);
        model.setData({
          loading: false,
          selectedErrorId: null,
          thresholds: results[0],
          errors: results[1],
          summary: {
            thresholds: results[0].length,
            openErrors: results[1].filter(function (row) { return row.status === "OPEN"; }).length,
            quarantined: results[1].length,
            retries: results[1].reduce(function (sum, row) { return sum + Number(row.retryCount || 0); }, 0)
          }
        });
      } catch (error) {
        model.setProperty("/loading", false);
        MessageToast.show("Administration console could not be loaded");
        throw error;
      }
    },

    onErrorSelectionChange: function (event) {
      const item = event.getParameter("listItem");
      const row = item && item.getBindingContext("admin") && item.getBindingContext("admin").getObject();
      this.getOwnerComponent().getModel("admin").setProperty("/selectedErrorId", row && row.ID);
    },

    onReplaySelectedError: async function () {
      const model = this.getOwnerComponent().getModel("admin");
      const errorId = model.getProperty("/selectedErrorId");
      if (!errorId) {
        MessageToast.show("Select an ingestion error first");
        return;
      }
      await this.executeAction("replayIngestionError", { errorId });
      MessageToast.show("Replay requested");
      this.loadAdmin();
    },

    onScrollToSection: function (event) {
      const target = event.getSource().data("target");
      const section = target && this.byId(target);
      const domRef = section && section.getDomRef();
      if (domRef) {
        this.scrollDomRefIntoView(domRef);
      }
    },

    scrollDomRefIntoView: function (domRef) {
      let scroller = domRef.parentElement;
      while (scroller && scroller !== document.body && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      if (scroller && scroller !== document.body) {
        const targetTop = scroller.scrollTop + domRef.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
        scroller.scrollTo({ top: targetTop, behavior: "smooth" });
      } else {
        domRef.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },

    severityState: function (value) {
      return value === "CRITICAL" ? "Error" : value === "HIGH" ? "Warning" : "Information";
    },

    errorState: function (value) {
      return value === "OPEN" ? "Warning" : value === "RESOLVED" ? "Success" : "Information";
    },

    hasSelectedError: function (value) {
      return !!value;
    }
  });
});
