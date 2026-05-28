sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("freshchain.masterdata.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({
        loading: true,
        summary: {},
        stores: [],
        zones: [],
        products: [],
        batches: [],
        placements: [],
        sensors: []
      }), "master");
    }
  });
});
