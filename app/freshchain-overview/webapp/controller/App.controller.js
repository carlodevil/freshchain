sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("freshchain.overview.controller.App", {
    onInit: function () {
      this.getView().setModel(new JSONModel({
        busy: false,
        outcome: "Moved stock to a safe zone, checked refrigeration, and started markdown proof.",
        status: {},
        impact: {},
        latestReading: {},
        latestRisk: {},
        scenario: {},
        task: {},
        brief: {},
        notification: {},
        integrations: [],
        messages: []
      }), "view");
      this.refresh();
    },

    refresh: function () {
      this._setBusy(true);
      Promise.all([
        this._readFirst("/DemoRunStatus"),
        this._readFirst("/DemoImpactMetrics"),
        this._readFirst("/LiveSensorEvents", { "$orderby": "measuredAt desc" }),
        this._readFirst("/RiskDecisions", { "$orderby": "createdAt desc" }),
        this._readFirst("/RescueScenarios", { "$orderby": "generatedAt desc" }),
        this._readFirst("/ProcessTasks", { "$orderby": "createdAt desc" }),
        this._readFirst("/ActionBriefs", { "$orderby": "generatedAt desc" }),
        this._readFirst("/NotificationEvents", { "$orderby": "createdAt desc" }),
        this._readList("/IntegrationStatuses")
      ]).then(function (results) {
        const model = this.getView().getModel("view");
        model.setProperty("/status", results[0] || {});
        model.setProperty("/impact", results[1] || {});
        model.setProperty("/latestReading", results[2] || {});
        model.setProperty("/latestRisk", results[3] || {});
        model.setProperty("/scenario", results[4] || {});
        model.setProperty("/task", results[5] || {});
        model.setProperty("/brief", results[6] || {});
        model.setProperty("/notification", results[7] || {});
        model.setProperty("/integrations", results[8] || []);
      }.bind(this)).catch(function (error) {
        MessageBox.error(this._messageFromError(error));
      }.bind(this)).finally(function () {
        this._setBusy(false);
      }.bind(this));
    },

    onStart: function () {
      this._executeAction("startLiveDemo");
    },

    onCreateReading: function () {
      this._executeAction("createLiveReading", { force: true });
    },

    onScore: function () {
      this._executeAction("scoreLatestLiveReading", { force: true });
    },

    onRunRescue: function () {
      this._executeAction("runRescueScenario");
    },

    onStop: function () {
      this._executeAction("stopLiveDemo");
    },

    onReset: function () {
      this._executeAction("resetDemoRun");
    },

    onCompleteTask: function () {
      const model = this.getView().getModel("view");
      const task = model.getProperty("/task") || {};
      if (!task.ID) {
        MessageToast.show("No workflow task is available yet.");
        return;
      }
      this._executeAction("completeInterventionTask", {
        taskID: task.ID,
        outcome: model.getProperty("/outcome")
      });
    },

    _executeAction: function (name, parameters) {
      const action = this.getOwnerComponent().getModel().bindContext("/" + name + "(...)");
      Object.keys(parameters || {}).forEach(function (key) {
        action.setParameter(key, parameters[key]);
      });
      this._setBusy(true);
      action.execute().then(function () {
        MessageToast.show("Demo action completed.");
        return this.refresh();
      }.bind(this)).catch(function (error) {
        MessageBox.error(this._messageFromError(error));
      }.bind(this)).finally(function () {
        this._setBusy(false);
      }.bind(this));
    },

    _readFirst: function (path, parameters) {
      return this._readList(path, Object.assign({ "$top": 1 }, parameters || {})).then(function (rows) {
        return rows[0] || null;
      });
    },

    _readList: function (path, parameters) {
      const model = this.getOwnerComponent().getModel();
      const top = Number((parameters && parameters.$top) || 100);
      const queryParameters = Object.assign({}, parameters || {});
      delete queryParameters.$top;
      const list = model.bindList(path, null, null, null, queryParameters);
      return list.requestContexts(0, top).then(function (contexts) {
        return contexts.map(function (context) {
          return context.getObject();
        });
      });
    },

    _setBusy: function (busy) {
      this.getView().getModel("view").setProperty("/busy", busy);
    },

    _messageFromError: function (error) {
      return error && (error.message || error.statusText) || "The demo action failed.";
    }
  });
});
