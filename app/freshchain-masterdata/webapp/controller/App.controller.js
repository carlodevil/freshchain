sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageToast"], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("freshchain.masterdata.controller.App", {
    onInit: function () {
      this.loadMasterData();
    },

    readList: async function (path, count) {
      const binding = this.getView().getModel().bindList("/" + path);
      const contexts = await binding.requestContexts(0, count || 30);
      return contexts.map(function (context) {
        return context.getObject();
      });
    },

    loadMasterData: async function () {
      const model = this.getOwnerComponent().getModel("master");
      model.setProperty("/loading", true);
      try {
        const results = await Promise.all([
          this.readList("Stores", 30),
          this.readList("Zones", 50),
          this.readList("Products", 50),
          this.readList("Batches", 50),
          this.readList("InventoryPlacements", 50),
          this.readList("Sensors", 50)
        ]);
        model.setData({
          loading: false,
          stores: results[0],
          zones: results[1],
          products: results[2],
          batches: results[3],
          placements: results[4],
          sensors: results[5],
          summary: {
            stores: results[0].length,
            zones: results[1].length,
            products: results[2].length,
            sensors: results[5].length
          }
        });
      } catch (error) {
        model.setProperty("/loading", false);
        MessageToast.show("Master data workspace could not be loaded");
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

    activeState: function (value) {
      return value ? "Success" : "Error";
    },

    healthState: function (value) {
      return value === "OK" ? "Success" : value === "WARN" || value === "STALE" ? "Warning" : "Error";
    }
  });
});
