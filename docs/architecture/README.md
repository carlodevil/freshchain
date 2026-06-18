# FreshChain Architecture Diagrams

This folder contains editable draw.io architecture diagrams for FreshChain.

## Files

- `FreshChain_BTP_Architecture.drawio` - editable diagrams.net source.
- `FreshChain_BTP_Architecture.svg` - vector preview generated from the same architecture model.
- `FreshChain_BTP_Architecture.png` - raster preview for documents and presentations.

## SAP diagram assets

The architecture diagram uses official SAP BTP Solution Diagram service icons from SAP's `btp-solution-diagrams` repository:

- SAP Build Work Zone
- SAP HTML5 Application Repository service
- Application Frontend service
- SAP Cloud Application Programming Model
- SAP Cloud Foundry runtime
- SAP HANA Cloud
- SAP AI Core
- SAP AI Launchpad
- SAP Integration Suite, event mesh
- SAP Destination service
- SAP Authorization and Trust Management service
- SAP Monitoring service for SAP BTP

The icons are embedded into the `.drawio` file as self-contained image shapes so the diagram opens without local asset paths.

## draw.io MCP

The official draw.io MCP package is `@drawio/mcp` and can be launched with:

```sh
npx -y @drawio/mcp
```

This running Codex session did not expose the draw.io MCP tools after inspection, so no local MCP configuration was committed. If the MCP server is enabled in a future session, open `FreshChain_BTP_Architecture.drawio` with `open_drawio_xml` for direct editing in draw.io.
