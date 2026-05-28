sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("freshchain.overview.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({
        loading: true,
        health: {},
        ml: {},
        alerts: [],
        riskTrend: [],
        forecasts: [],
        replenishments: [],
        routes: [],
        telemetry: [],
        modelQuality: [],
        scenarioMix: [],
        dataFreshness: {},
        datasets: [],
        trainingRuns: [],
        deployments: []
      }), "overview");
    }
  });
});
