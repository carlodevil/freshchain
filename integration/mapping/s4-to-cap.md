# S/4HANA to CAP Mapping

S/4HANA integration is intentionally outside the v1 implementation path. The CAP model keeps stable targets for a later Integration Suite iFlow:

| S/4HANA Concept | CAP Target |
| --- | --- |
| Material / Product ID | `Products.sku` |
| Material Description | `Products.name` |
| Material Group / Hierarchy | `Products.category`, `Products.subcategory` |
| Base Unit of Measure | `Products.uom` |
| Shelf-life settings | `Products.standardShelfLifeDays` |
| Recommended storage condition | `Products.recommendedTempMinC`, `Products.recommendedTempMaxC` |
| Batch / Lot number | `Batches.batchNumber` |
| Production, packing, best-before dates | `Batches.productionDate`, `packingDate`, `bestBeforeDate` |
| Plant / Storage Location | mapping table to `Stores` / `Zones` |
