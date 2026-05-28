sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageToast"], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("freshchain.monitoring.controller.App", {
    onInit: function () {
      this.loadMonitoring();
    },

    readList: async function (path, count) {
      const binding = this.getView().getModel().bindList("/" + path);
      const contexts = await binding.requestContexts(0, count || 20);
      return contexts.map(function (context) {
        return context.getObject();
      });
    },

    loadMonitoring: async function () {
      const model = this.getOwnerComponent().getModel("monitor");
      model.setProperty("/loading", true);
      try {
        const results = await Promise.all([
          this.readList("ZoneStatus", 20),
          this.readList("ActiveAlerts", 20),
          this.readList("ReadingAggregates", 20)
        ]);
        const zones = results[0];
        const alerts = results[1];
        const aggregates = results[2];
        model.setData({
          loading: false,
          zones,
          alerts,
          aggregates,
          summary: {
            activeZones: zones.filter(function (zone) { return zone.active; }).length,
            activeAlerts: alerts.length,
            criticalAlerts: alerts.filter(function (alert) { return alert.severity === "CRITICAL"; }).length,
            latestAggregate: aggregates[0] && aggregates[0].windowEnd
          }
        });
      } catch (error) {
        model.setProperty("/loading", false);
        MessageToast.show("Monitoring cockpit could not be loaded");
        throw error;
      }
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
      return value === "CRITICAL" ? "Error" : value === "HIGH" ? "Warning" : value === "MEDIUM" ? "Information" : "Success";
    },

    activeState: function (value) {
      return value ? "Success" : "Error";
    }
  });
});
