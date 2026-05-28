sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("freshchain.intelligence.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({
        loading: true,
        pipeline: {},
        dataFreshness: {},
        datasets: [],
        uploads: [],
        selectedUploadId: null,
        trainingRuns: [],
        deployments: [],
        modelQuality: [],
        telemetry: [],
        zones: []
      }), "workbench");
    }
  });
});
