sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("freshchain.admin.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({
        loading: true,
        selectedErrorId: null,
        summary: {},
        thresholds: [],
        errors: []
      }), "admin");
    }
  });
});
