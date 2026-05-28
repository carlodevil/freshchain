sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("freshchain.operations.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({
        loading: false,
        selectedAlertId: null,
        summary: {
          open: 0,
          critical: 0,
          acknowledged: 0,
          resolved: 0
        },
        alerts: [],
        actions: []
      }), "operations");
    }
  });
});
