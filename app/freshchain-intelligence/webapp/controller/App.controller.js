sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageToast", "sap/ui/model/Sorter"], function (Controller, MessageToast, Sorter) {
  "use strict";

  return Controller.extend("freshchain.intelligence.controller.App", {
    onInit: function () {
      this.loadWorkbench();
    },

    readList: async function (path, count, sortPath) {
      const sorters = sortPath ? [new Sorter(sortPath, true)] : undefined;
      const binding = this.getView().getModel().bindList("/" + path, null, sorters);
      const contexts = await binding.requestContexts(0, count || 20);
      return contexts.map(function (context) {
        return context.getObject();
      });
    },

    enrichUpload: function (upload) {
      const validation = this.parseJson(upload.validationSummary);
      const imported = this.parseJson(upload.importSummary);
      const rows = validation.rowCounts || imported.rowCounts || {};
      const errors = validation.errors || [];
      return Object.assign({}, upload, {
        rowSummary: "Readings " + (rows["sensor_readings.csv"] || 0) + ", Sales " + (rows["sales_observations.csv"] || 0),
        errorSummary: errors.length ? errors.slice(0, 3).join("; ") : "No validation errors",
        importedDatasetCode: imported.datasetCode || "",
        canImport: upload.status === "VALIDATED",
        canDelete: upload.status !== "IMPORTED"
      });
    },

    parseJson: function (value) {
      try {
        return value ? JSON.parse(value) : {};
      } catch (error) {
        return {};
      }
    },

    executeAction: async function (name, parameters) {
      const binding = this.getView().getModel().bindContext("/" + name + "(...)");
      Object.keys(parameters || {}).forEach(function (key) {
        binding.setParameter(key, parameters[key]);
      });
      await binding.execute();
      return binding.getBoundContext().requestObject();
    },

    loadWorkbench: async function () {
      const model = this.getOwnerComponent().getModel("workbench");
      model.setProperty("/loading", true);
      try {
        const results = await Promise.all([
          this.readList("MLDatasets", 8, "generatedAt"),
          this.readList("MLTrainingRuns", 8, "startedAt"),
          this.readList("MLDeployments", 8, "modifiedAt"),
          this.readList("ModelQualityDashboard", 8),
          this.readList("InferenceTelemetry", 8),
          this.readList("DataFreshness", 1),
          this.readList("Zones", 4),
          this.readList("DatasetUploads", 10, "uploadedAt")
        ]);
        const latestDataset = results[0][0] || {};
        const latestRun = results[1][0] || {};
        const uploads = results[7].map(this.enrichUpload.bind(this));
        const latestUpload = uploads[0] || {};
        const activeDeployment = (results[2] || []).find(function (row) {
          return row.status === "SUCCEEDED";
        }) || results[2][0] || {};
        model.setData({
          loading: false,
          pipeline: {
            latestDataset: latestDataset.datasetCode,
            latestRun: latestRun.runId,
            latestRunStatus: latestRun.status,
            activeDeployment: activeDeployment.deploymentId,
            deploymentHealth: activeDeployment.healthStatus,
            latestUpload: latestUpload.status,
            latestUploadName: latestUpload.fileName
          },
          datasets: results[0],
          uploads: uploads,
          selectedUploadId: model.getProperty("/selectedUploadId"),
          trainingRuns: results[1],
          deployments: results[2],
          modelQuality: results[3],
          telemetry: results[4],
          dataFreshness: results[5][0] || {},
          zones: results[6]
        });
      } catch (error) {
        model.setProperty("/loading", false);
        MessageToast.show("Data science workbench could not be loaded");
        throw error;
      }
    },

    onDatasetPackageSelected: async function (event) {
      const file = event.getParameter("files") && event.getParameter("files")[0];
      if (!file) return;
      if (!/\.zip$/i.test(file.name)) {
        MessageToast.show("Choose a ZIP package");
        return;
      }
      try {
        const contentBase64 = await this.fileToBase64(file);
        const upload = await this.executeAction("uploadDatasetPackage", {
          fileName: file.name,
          mimeType: file.type || "application/zip",
          contentBase64: contentBase64
        });
        await this.executeAction("validateDatasetPackage", { uploadId: upload.ID });
        MessageToast.show("Dataset package uploaded and validated");
        this.loadWorkbench();
      } catch (error) {
        MessageToast.show("Dataset package could not be uploaded");
        throw error;
      }
    },

    onDownloadDatasetTemplate: async function () {
      const result = await this.executeAction("downloadDatasetPackageTemplate", {});
      const base64 = result && (result.value || result);
      if (!base64) {
        MessageToast.show("Template package could not be generated");
        return;
      }
      const bytes = Uint8Array.from(atob(base64), function (char) {
        return char.charCodeAt(0);
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "freshchain-dataset-template.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      MessageToast.show("Dataset template downloaded");
    },

    fileToBase64: function (file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          const bytes = new Uint8Array(reader.result);
          const chunkSize = 32768;
          let binary = "";
          for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
          }
          resolve(btoa(binary));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
    },

    onDatasetUploadSelectionChange: function (event) {
      const item = event.getParameter("listItem");
      const context = item && item.getBindingContext("workbench");
      const upload = context && context.getObject();
      this.getOwnerComponent().getModel("workbench").setProperty("/selectedUploadId", upload && upload.ID);
    },

    selectedUpload: function () {
      const model = this.getOwnerComponent().getModel("workbench");
      const selectedUploadId = model.getProperty("/selectedUploadId");
      const uploads = model.getProperty("/uploads") || [];
      return uploads.find(function (upload) {
        return upload.ID === selectedUploadId;
      }) || uploads[0];
    },

    onValidateSelectedUpload: async function () {
      const upload = this.selectedUpload();
      if (!upload) {
        MessageToast.show("Select an upload first");
        return;
      }
      await this.executeAction("validateDatasetPackage", { uploadId: upload.ID });
      MessageToast.show("Dataset package validated");
      this.loadWorkbench();
    },

    onImportSelectedUpload: async function () {
      const upload = this.selectedUpload();
      if (!upload) {
        MessageToast.show("Select a validated upload first");
        return;
      }
      if (upload.status !== "VALIDATED") {
        MessageToast.show("Validate the package successfully before import");
        return;
      }
      await this.executeAction("importDatasetPackage", { uploadId: upload.ID });
      MessageToast.show("Dataset imported and ready for training");
      this.loadWorkbench();
    },

    onDeleteSelectedUpload: async function () {
      const upload = this.selectedUpload();
      if (!upload) {
        MessageToast.show("Select an upload first");
        return;
      }
      if (upload.status === "IMPORTED") {
        MessageToast.show("Imported packages are retained for lineage");
        return;
      }
      await this.executeAction("deleteDatasetUpload", { uploadId: upload.ID });
      MessageToast.show("Dataset upload deleted");
      this.getOwnerComponent().getModel("workbench").setProperty("/selectedUploadId", null);
      this.loadWorkbench();
    },

    onStartTraining: async function () {
      const datasets = this.getOwnerComponent().getModel("workbench").getProperty("/datasets") || [];
      if (!datasets.length) {
        MessageToast.show("Seed or ingest a dataset before starting training");
        return;
      }
      await this.executeAction("startTraining", { datasetCode: datasets[0].datasetCode });
      MessageToast.show("AI Core training execution started");
      this.loadWorkbench();
    },

    onActivateLatest: async function () {
      const runs = this.getOwnerComponent().getModel("workbench").getProperty("/trainingRuns") || [];
      if (!runs.length) {
        MessageToast.show("Start training before activating a deployment");
        return;
      }
      await this.executeAction("activateDeployment", { trainingRunId: runs[0].ID });
      MessageToast.show("AI Core deployment requested");
      this.loadWorkbench();
    },

    onRefreshLatestRun: async function () {
      const runs = this.getOwnerComponent().getModel("workbench").getProperty("/trainingRuns") || [];
      if (!runs.length) {
        MessageToast.show("No training run is available");
        return;
      }
      await this.executeAction("refreshTrainingRun", { trainingRunId: runs[0].ID });
      MessageToast.show("Training status refreshed from AI Core");
      this.loadWorkbench();
    },

    onRefreshLatestDeployment: async function () {
      const deployments = this.getOwnerComponent().getModel("workbench").getProperty("/deployments") || [];
      if (!deployments.length) {
        MessageToast.show("No deployment is available");
        return;
      }
      await this.executeAction("refreshDeployment", { deploymentId: deployments[0].ID });
      MessageToast.show("Deployment status refreshed from AI Core");
      this.loadWorkbench();
    },

    onScoreLatest: async function () {
      const zones = this.getOwnerComponent().getModel("workbench").getProperty("/zones") || [];
      if (!zones.length) {
        MessageToast.show("No active zone is available for scoring");
        return;
      }
      await this.executeAction("scoreLatest", { zoneId: zones[0].ID });
      MessageToast.show("Latest zone scored");
      this.loadWorkbench();
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

    stateForStatus: function (value) {
      return value === "SUCCEEDED" || value === "GOOD" || value === "ONLINE" || value === "VALIDATED" || value === "IMPORTED" ? "Success"
        : value === "RUNNING" || value === "WATCH" || value === "PENDING" || value === "UNKNOWN" || value === "NOT_DEPLOYED" || value === "UPLOADED" ? "Warning"
          : value === "FAILED" || value === "BREACH" ? "Error" : "Information";
    },

    boolState: function (value) {
      return value ? "Warning" : "Success";
    }
  });
});
