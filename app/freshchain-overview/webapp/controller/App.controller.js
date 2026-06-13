sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageToast"], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("freshchain.overview.controller.App", {
    onInit: function () {
      this.loadOverview();
    },

    executeAction: async function (name, parameters) {
      const binding = this.getView().getModel().bindContext("/" + name + "(...)");
      Object.keys(parameters || {}).forEach(function (key) {
        binding.setParameter(key, parameters[key]);
      });
      await binding.execute();
      return binding.getBoundContext().requestObject();
    },

    readList: async function (path, count) {
      const binding = this.getView().getModel().bindList("/" + path);
      const contexts = await binding.requestContexts(0, count || 20);
      return contexts.map(function (context) {
        return context.getObject();
      });
    },

    loadOverview: async function () {
      const model = this.getOwnerComponent().getModel("overview");
      model.setProperty("/loading", true);
      try {
        const results = await Promise.all([
          this.readList("OverviewMetrics", 1),
          this.readList("RiskTrend", 1),
          this.readList("ForecastDashboard", 1),
          this.readList("ReplenishmentDashboard", 1),
          this.readList("RouteDashboard", 1),
          this.readList("InferenceTelemetry", 1),
          this.readList("ModelQualityDashboard", 20),
          this.readList("ScenarioMix", 12),
          this.readList("DataFreshness", 1),
          this.readList("MLDatasets", 1),
          this.readList("MLTrainingRuns", 1),
          this.readList("MLDeployments", 5),
          this.readList("Predictions", 1)
        ]);
        const metrics = results[0][0] || {};
        const latestPrediction = results[12][0] || {};
        const localMode = latestPrediction.deploymentId === "freshchain-local";
        const latestQualityByMetric = results[6].filter(function (row, index, rows) {
          return rows.findIndex(function (candidate) {
            return candidate.metricName === row.metricName;
          }) === index;
        });
        model.setData({
          ...model.getData(),
          generatedAt: metrics.generatedAt,
          health: {
            status: metrics.status,
            stores: metrics.stores,
            zones: metrics.zones,
            activeAlerts: metrics.activeAlerts,
            criticalAlerts: metrics.criticalAlerts,
            highAlerts: metrics.highAlerts,
            highestRisk: metrics.highestRisk,
            latestReadingAt: metrics.latestReadingAt
          },
          ml: {
            activeDeploymentId: metrics.activeDeploymentId,
            modelVersion: metrics.modelVersion,
            deploymentHealth: metrics.deploymentHealth,
            inferenceCount: metrics.inferenceCount,
            aiFailureRate: metrics.aiFailureRate
          },
          riskTrend: results[1],
          forecasts: results[2],
          replenishments: results[3],
          routes: results[4],
          telemetry: results[5],
          modelQuality: latestQualityByMetric,
          scenarioMix: results[7],
          dataFreshness: results[8][0] || {},
          datasets: results[9],
          trainingRuns: results[10],
          deployments: localMode ? [{
            deploymentId: latestPrediction.deploymentId,
            modelName: latestPrediction.modelName,
            modelVersion: latestPrediction.modelVersion,
            healthStatus: "ONLINE",
            endpointUrl: "Local Docker model"
          }] : results[11],
          loading: false
        });
      } catch (error) {
        model.setProperty("/loading", false);
        MessageToast.show("Overview data could not be loaded");
        throw error;
      }
    },

    onScoreLatest: async function () {
      const overview = this.getOwnerComponent().getModel("overview").getData();
      let zoneId = overview.riskTrend && overview.riskTrend[0] && overview.riskTrend[0].zoneId;
      if (!zoneId) {
        const zones = await this.readList("Zones", 1);
        zoneId = zones[0] && zones[0].ID;
      }
      if (!zoneId) {
        MessageToast.show("No active zone is available for scoring.");
        return;
      }
      await this.executeAction("scoreLatest", {
        zoneId: zoneId
      });
      MessageToast.show("Latest zone scored");
      this.loadOverview();
    },

    onApplyTopReplenishment: async function () {
      const overview = this.getOwnerComponent().getModel("overview").getData();
      const item = (overview.replenishments || []).find(function (row) {
        return row.status === "NEW";
      });
      if (!item) {
        MessageToast.show("No new replenishment recommendation to apply");
        return;
      }
      await this.executeAction("applyReplenishmentRecommendation", { recommendationId: item.ID });
      MessageToast.show("Replenishment recommendation applied");
      this.loadOverview();
    },

    onApplyTopRoute: async function () {
      const overview = this.getOwnerComponent().getModel("overview").getData();
      const item = (overview.routes || []).find(function (row) {
        return row.status === "NEW";
      });
      if (!item) {
        MessageToast.show("No new transfer recommendation to apply");
        return;
      }
      await this.executeAction("applyRouteRecommendation", { recommendationId: item.ID });
      MessageToast.show("Transfer recommendation applied");
      this.loadOverview();
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

    statusState: function (status) {
      return status === "CRITICAL" ? "Error" : status === "ATTENTION" ? "Warning" : "Success";
    },

    valueColor: function (status) {
      return status === "CRITICAL" ? "Error" : status === "ATTENTION" ? "Critical" : "Good";
    },

    riskColor: function (risk) {
      return risk === "CRITICAL" || risk === "HIGH" ? "Error" : risk === "MEDIUM" ? "Critical" : "Good";
    },

    riskState: function (risk) {
      return risk === "CRITICAL" || risk === "HIGH" ? "Error" : risk === "MEDIUM" ? "Warning" : "Success";
    },

    aiFailureColor: function (rate) {
      return Number(rate) > 0.5 ? "Critical" : "Good";
    },

    aiFailureState: function (rate) {
      return Number(rate) > 0.5 ? "Warning" : "Success";
    },

    percent: function (value) {
      return Math.round(Number(value || 0) * 100);
    },

    score: function (value) {
      return Number(value || 0).toFixed(2);
    },

    priorityState: function (value) {
      return Number(value) <= 1 ? "Error" : Number(value) <= 2 ? "Warning" : "Success";
    },

    boolState: function (value) {
      return value ? "Warning" : "Success";
    },

    qualityState: function (value) {
      return value === "BREACH" ? "Error" : value === "WATCH" ? "Warning" : "Success";
    },

    freshnessValue: function (value) {
      if (value === null || value === undefined) {
        return "-";
      }
      return String(value);
    }
  });
});
