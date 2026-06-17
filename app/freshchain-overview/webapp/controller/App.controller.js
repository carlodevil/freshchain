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
        actionsEnabled: true,
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
        messages: [],
        display: this._emptyDisplay()
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
        this._updateDisplayModel();
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

    _updateDisplayModel: function () {
      const model = this.getView().getModel("view");
      const status = model.getProperty("/status") || {};
      let reading = model.getProperty("/latestReading") || {};
      let risk = model.getProperty("/latestRisk") || {};
      let scenario = model.getProperty("/scenario") || {};
      let task = model.getProperty("/task") || {};
      let brief = model.getProperty("/brief") || {};
      let notification = model.getProperty("/notification") || {};
      const integrations = model.getProperty("/integrations") || [];

      if (!status.lastMessageId || reading.sourceMessageId !== status.lastMessageId) {
        reading = {};
        risk = {};
        scenario = {};
        task = {};
        brief = {};
        notification = {};
      } else {
        if (risk.createdAt && reading.measuredAt && !this._isAtOrAfter(risk.createdAt, reading.measuredAt)) {
          risk = {};
        }
        if (scenario.generatedAt && reading.measuredAt && !this._isAtOrAfter(scenario.generatedAt, reading.measuredAt)) {
          scenario = {};
        }
        if (!scenario.ID) {
          task = {};
          brief = {};
          notification = {};
        } else {
          if (task.scenarioID !== scenario.ID) task = {};
          if (brief.scenarioID !== scenario.ID) brief = {};
          if (notification.scenarioID !== scenario.ID) notification = {};
        }
      }

      model.setProperty("/latestReading", reading);
      model.setProperty("/latestRisk", risk);
      model.setProperty("/scenario", scenario);
      model.setProperty("/task", task);
      model.setProperty("/brief", brief);
      model.setProperty("/notification", notification);

      const riskLevel = risk.riskLevel || scenario.riskLevel || "Not scored";
      const stockAtRisk = Number(scenario.businessValueAtRiskZar || 0);
      const expectedLoss = Number(scenario.expectedLossZar || 0);
      const protectedValue = Number(scenario.protectedRevenueZar || scenario.potentialProtectedRevenueZar || 0);
      const affectedUnits = Number(scenario.affectedUnits || 0);
      const lotCount = Number(scenario.affectedLotCount || 0);
      const salvageRate = Number(scenario.salvageRate || 0);
      const score = Number(risk.score || scenario.spoilageProbability || 0);
      const confidence = Number(risk.confidence || scenario.confidence || 0);
      const averageUnitRetail = affectedUnits ? stockAtRisk / affectedUnits : 0;
      const estateImpact = this._estateImpact(protectedValue, affectedUnits);
      const taskStatus = task.status || "No task yet";
      const workflowState = this._stateForTask(taskStatus);
      const successfulIntegrations = integrations.filter(function (row) {
        return String(row.status || "").toUpperCase() === "ONLINE" || String(row.status || "").toUpperCase() === "SIMULATED" || String(row.status || "").toUpperCase() === "READY";
      }).length;

      model.setProperty("/display", {
        runMessage: status.message || "Run the sequence from left to right to turn a temperature breach into a priced rescue action.",
        incidentTitle: this._incidentTitle(reading, scenario),
        incidentSubtitle: this._incidentSubtitle(reading, scenario),
        riskLabel: "Risk: " + riskLevel,
        riskState: this._stateForRisk(riskLevel),
        workflowLabel: "Workflow: " + taskStatus,
        workflowState: workflowState,
        taskStatus: taskStatus,
        temperatureLabel: this._temperatureLabel(reading),
        temperatureState: this._temperatureState(reading),
        aiProofLabel: risk.ID ? "AI decision recorded" : "Awaiting AI score",
        aiProofState: risk.ID ? "Success" : "None",
        integrationLabel: successfulIntegrations + " integrations reporting",
        integrationState: successfulIntegrations ? "Success" : "Warning",
        nextAction: scenario.nextBestAction || risk.recommendedAction || "Create a live reading, score it, then build the rescue plan.",
        actionReason: scenario.headline || "FreshChain converts telemetry into stock value at risk, expected loss, and a store task with proof.",
        stockAtRisk: this._formatCurrency(stockAtRisk),
        stockAtRiskContext: lotCount ? lotCount + " lots, " + this._formatQuantity(affectedUnits) + " units priced from stock ledger" : "No affected stock priced yet",
        expectedLoss: this._formatCurrency(expectedLoss),
        expectedLossContext: this._formatPercent(score) + " AI risk x " + this._formatPercent(confidence) + " confidence",
        protectedValue: this._formatCurrency(protectedValue),
        protectedValueContext: salvageRate ? "Capped by " + this._formatPercent(salvageRate) + " maintained salvage rate" : "Pending rescue plan",
        slaMinutes: scenario.responseSlaMinutes || task.dueInMinutes || 0,
        slaContext: task.assignee ? "Assigned to " + task.assignee : "Generated from risk-level response policy",
        riskScore: score ? score.toFixed(3) : "0.000",
        confidenceLabel: "Confidence: " + this._formatPercent(confidence),
        modelLabel: [risk.modelName, risk.modelVersion].filter(Boolean).join(" ") || "Not scored",
        measuredAt: this._formatDateTime(reading.measuredAt),
        affectedStockLabel: lotCount ? lotCount + " lots / " + this._formatQuantity(affectedUnits) + " units / " + (scenario.productName || "mixed chilled stock") : "No rescue stock selected yet",
        calculationSummary: scenario.calculationSummary || "Financial proof appears once the rescue scenario is generated.",
        financialLines: this._financialLines(stockAtRisk, expectedLoss, protectedValue, affectedUnits, averageUnitRetail, score, confidence, salvageRate),
        scaleMetrics: estateImpact.metrics,
        scaleAssumption: estateImpact.assumption,
        steps: this._steps(status, reading, risk, scenario, task)
      });
    },

    _estateImpact: function (protectedValue, affectedUnits) {
      const incidentValue = Number(protectedValue || 0);
      const units = Number(affectedUnits || 0);
      const storeCount = 20;
      const weeklyIncidentsPerStore = 1;
      const weeksPerYear = 52;
      const weeklyEstateValue = incidentValue * storeCount * weeklyIncidentsPerStore;
      const annualEstateValue = weeklyEstateValue * weeksPerYear;
      const weeklyUnits = units * storeCount * weeklyIncidentsPerStore;

      return {
        assumption: "Scale scenario: one comparable cold-chain incident per store per week across a 20-store estate. The live proof remains the single ST001 movement; these figures show why the same control loop matters at chain scale.",
        metrics: [
          {
            title: "This incident",
            value: this._formatCurrency(incidentValue),
            detail: "Persisted protected revenue after the store action is completed.",
            state: "Success"
          },
          {
            title: "Weekly estate exposure",
            value: this._formatCurrency(weeklyEstateValue),
            detail: storeCount + " stores x one comparable incident, based on the same stock-ledger calculation.",
            state: "Warning"
          },
          {
            title: "Annualized upside",
            value: this._formatCurrency(annualEstateValue),
            detail: "52-week extrapolation, equivalent to rescuing about " + this._formatQuantity(weeklyUnits * weeksPerYear) + " units.",
            state: "Information"
          }
        ]
      };
    },

    _financialLines: function (stockAtRisk, expectedLoss, protectedValue, affectedUnits, averageUnitRetail, score, confidence, salvageRate) {
      return [
        {
          title: "Stock at risk",
          detail: this._formatQuantity(affectedUnits) + " active units x " + this._formatCurrency(averageUnitRetail) + " average retail = " + this._formatCurrency(stockAtRisk),
          icon: "sap-icon://inventory"
        },
        {
          title: "Expected loss",
          detail: this._formatCurrency(stockAtRisk) + " x " + this._formatPercent(score) + " risk x " + this._formatPercent(confidence) + " confidence = " + this._formatCurrency(expectedLoss),
          icon: "sap-icon://trend-down"
        },
        {
          title: "Protected value",
          detail: "Lower of expected loss and salvage cap (" + this._formatCurrency(stockAtRisk) + " x " + this._formatPercent(salvageRate) + ") = " + this._formatCurrency(protectedValue),
          icon: "sap-icon://money-bills"
        }
      ];
    },

    _steps: function (status, reading, risk, scenario, task) {
      return [
        this._step(1, "Start incident", status.startedAt, "Run context is active and ready for telemetry."),
        this._step(2, "Create live reading", reading.ID, reading.ID ? this._temperatureLabel(reading) + " from " + (reading.sensorId || "sensor") : "Generate the temperature breach."),
        this._step(3, "Score risk", risk.ID, risk.ID ? "AI returned " + (risk.riskLevel || "risk") + " with " + this._formatPercent(Number(risk.confidence || 0)) + " confidence." : "Send the latest reading to AI Core scoring."),
        this._step(4, "Build rescue plan", scenario.ID, scenario.ID ? this._formatCurrency(Number(scenario.potentialProtectedRevenueZar || scenario.protectedRevenueZar || 0)) + " protected revenue calculated." : "Price the affected stock and create the store action."),
        this._step(5, "Complete proof", String(task.status || "").toUpperCase() === "COMPLETED", task.ID ? "Task status: " + (task.status || "created") : "Complete the action to write movement and audit proof.")
      ];
    },

    _step: function (index, title, completed, detail) {
      return {
        index: String(index),
        title: title,
        detail: detail,
        state: completed ? "Success" : "None"
      };
    },

    _incidentTitle: function (reading, scenario) {
      const store = reading.storeCode || scenario.storeCode || "Store";
      const zone = reading.zoneCode || scenario.zoneCode || "affected zone";
      return store + " / " + zone;
    },

    _incidentSubtitle: function (reading, scenario) {
      const product = scenario.productName || "chilled stock";
      const scenarioCode = reading.scenarioCode || scenario.scenarioCode || "live incident";
      return product + " under " + scenarioCode + " conditions";
    },

    _temperatureLabel: function (reading) {
      const value = Number(reading.temperatureC);
      return Number.isFinite(value) ? value.toFixed(1) + " C live reading" : "No live reading yet";
    },

    _temperatureState: function (reading) {
      const value = Number(reading.temperatureC);
      if (!Number.isFinite(value)) return "None";
      return value >= 8 ? "Error" : value >= 5 ? "Warning" : "Success";
    },

    _stateForRisk: function (riskLevel) {
      const value = String(riskLevel || "").toUpperCase();
      if (value === "CRITICAL" || value === "HIGH") return "Error";
      if (value === "MEDIUM") return "Warning";
      if (value === "LOW") return "Success";
      return "None";
    },

    _stateForTask: function (taskStatus) {
      const value = String(taskStatus || "").toUpperCase();
      if (value === "COMPLETED" || value === "ACTIONED") return "Success";
      if (value === "OPEN" || value === "READY" || value === "IN_PROGRESS") return "Warning";
      if (value === "FAILED") return "Error";
      return "None";
    },

    _isAtOrAfter: function (value, reference) {
      if (!value || !reference) return false;
      return new Date(value).getTime() >= new Date(reference).getTime();
    },

    _formatCurrency: function (value) {
      const amount = Number(value || 0);
      return new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency: "ZAR",
        maximumFractionDigits: 0
      }).format(Number.isFinite(amount) ? amount : 0);
    },

    _formatPercent: function (value) {
      const number = Number(value || 0);
      return new Intl.NumberFormat("en-ZA", {
        style: "percent",
        maximumFractionDigits: 1
      }).format(Number.isFinite(number) ? number : 0);
    },

    _formatQuantity: function (value) {
      const amount = Number(value || 0);
      return new Intl.NumberFormat("en-ZA", {
        maximumFractionDigits: 0
      }).format(Number.isFinite(amount) ? amount : 0);
    },

    _formatDateTime: function (value) {
      if (!value) return "";
      return new Intl.DateTimeFormat("en-ZA", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    },

    _emptyDisplay: function () {
      return {
        runMessage: "Run the sequence from left to right to turn a temperature breach into a priced rescue action.",
        incidentTitle: "No incident selected",
        incidentSubtitle: "Start the demo sequence to create one.",
        riskLabel: "Risk: Not scored",
        riskState: "None",
        workflowLabel: "Workflow: No task yet",
        workflowState: "None",
        taskStatus: "No task yet",
        financialLines: [],
        steps: []
      };
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
      const model = this.getView().getModel("view");
      model.setProperty("/busy", busy);
      model.setProperty("/actionsEnabled", !busy);
    },

    _messageFromError: function (error) {
      return error && (error.message || error.statusText) || "The demo action failed.";
    }
  });
});
