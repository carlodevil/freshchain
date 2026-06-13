"""Reference data generator for the FreshChain ML Pipeline.

Generates stores, zones, products, batches, and inventory placements with
full referential integrity across all datasets.
"""

import logging
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from freshchain_ml_pipeline.config import PipelineConfig

logger = logging.getLogger("freshchain_ml_pipeline")

# Zone definitions: each store gets one of each zone type
ZONE_TYPES = {
    "chiller": 3.0,
    "ambient": 24.0,
    "freezer": -18.0,
}

# Product categories with shelf-life ranges (days) and storage requirements
# Ranges calibrated to produce a balanced distribution of days_remaining across
# CRITICAL/HIGH/MEDIUM/LOW risk levels when combined with the degradation model.
CATEGORY_CONFIG = {
    "produce": {
        "shelf_life_range": (7, 14),
        "storage_requirement": "ambient",
    },
    "dairy": {
        "shelf_life_range": (14, 28),
        "storage_requirement": "chiller",
    },
    "poultry": {
        "shelf_life_range": (5, 10),
        "storage_requirement": "chiller",
    },
    "cooked_starch": {
        "shelf_life_range": (7, 12),
        "storage_requirement": "ambient",
    },
    "ready_made_salad": {
        "shelf_life_range": (5, 10),
        "storage_requirement": "chiller",
    },
}

# Product name templates per category
PRODUCT_NAMES = {
    "produce": [
        "Spinach Bundle", "Lettuce Head", "Tomatoes 1kg", "Carrots 500g",
        "Broccoli Crown", "Cucumber", "Bell Peppers 3pk", "Avocado 4pk",
        "Mushrooms 250g", "Baby Spinach 200g",
    ],
    "dairy": [
        "Full Cream Milk 2L", "Low Fat Yoghurt 500g", "Cheddar Cheese 400g",
        "Butter 500g", "Fresh Cream 250ml", "Cottage Cheese 250g",
        "Gouda Slices 200g", "Amasi 500ml", "Feta 200g", "Maas 1L",
    ],
    "poultry": [
        "Chicken Breast 1kg", "Chicken Thighs 800g", "Whole Chicken 1.5kg",
        "Chicken Wings 1kg", "Chicken Drumsticks 1kg", "Chicken Mince 500g",
        "Chicken Livers 500g", "Chicken Strips 400g", "Chicken Fillets 600g",
        "Chicken Portions 2kg",
    ],
    "cooked_starch": [
        "Cooked Rice 500g", "Pap 1kg", "Cooked Pasta 400g",
        "Potato Salad 500g", "Couscous 300g", "Polenta 500g",
        "Rice Salad 400g", "Noodle Bowl 350g", "Quinoa Mix 300g",
        "Samp 1kg",
    ],
    "ready_made_salad": [
        "Greek Salad 300g", "Caesar Salad 250g", "Garden Salad 200g",
        "Coleslaw 400g", "Pasta Salad 350g", "Quinoa Salad 300g",
        "Asian Noodle Salad 350g", "Beetroot Salad 250g", "Chicken Salad 300g",
        "Mediterranean Salad 350g",
    ],
}

REGIONS = ["Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Free State"]
STORE_TYPES = ["supermarket", "express", "hypermarket"]


def generate_reference_data(
    config: PipelineConfig, rng: np.random.Generator
) -> dict[str, pd.DataFrame]:
    """Generate all reference datasets with referential integrity.

    Produces stores, zones, products, batches, and inventory placements
    that are internally consistent and cross-referenced.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration controlling scale (num_stores, num_skus_per_store,
        num_days).
    rng : np.random.Generator
        NumPy random generator for reproducible output.

    Returns
    -------
    dict[str, pd.DataFrame]
        Dictionary with keys: "stores", "zones", "products", "batches",
        "inventory_placements". Each value is a pandas DataFrame.
    """
    stores_df = _generate_stores(config, rng)
    zones_df = _generate_zones(stores_df)
    products_df = _generate_products(config, rng)
    batches_df = _generate_batches(config, products_df, rng)
    placements_df = _generate_inventory_placements(
        config, batches_df, products_df, stores_df, zones_df, rng
    )

    logger.info(
        "Generated reference data: %d stores, %d zones, %d products, "
        "%d batches, %d placements",
        len(stores_df),
        len(zones_df),
        len(products_df),
        len(batches_df),
        len(placements_df),
    )

    return {
        "stores": stores_df,
        "zones": zones_df,
        "products": products_df,
        "batches": batches_df,
        "inventory_placements": placements_df,
    }


def _generate_stores(config: PipelineConfig, rng: np.random.Generator) -> pd.DataFrame:
    """Generate store metadata.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration with num_stores.
    rng : np.random.Generator
        Random generator for reproducible selection.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: storeCode, storeName, region, storeType.
    """
    records = []
    for i in range(config.num_stores):
        store_code = f"STORE-{i + 1:03d}"
        region = REGIONS[i % len(REGIONS)]
        store_type = STORE_TYPES[i % len(STORE_TYPES)]
        store_name = f"FreshChain {region} {store_type.title()} {i + 1}"
        records.append(
            {
                "storeCode": store_code,
                "storeName": store_name,
                "region": region,
                "storeType": store_type,
            }
        )

    return pd.DataFrame(records)


def _generate_zones(stores_df: pd.DataFrame) -> pd.DataFrame:
    """Generate zone metadata — one zone per type per store.

    Parameters
    ----------
    stores_df : pd.DataFrame
        Stores DataFrame with storeCode column.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: zoneCode, storeCode, zoneType, targetTemperatureC.
    """
    records = []
    for store_code in stores_df["storeCode"]:
        for zone_type, target_temp in ZONE_TYPES.items():
            zone_code = f"{store_code}-{zone_type.upper()}"
            records.append(
                {
                    "zoneCode": zone_code,
                    "storeCode": store_code,
                    "zoneType": zone_type,
                    "targetTemperatureC": target_temp,
                }
            )

    return pd.DataFrame(records)


def _generate_products(
    config: PipelineConfig, rng: np.random.Generator
) -> pd.DataFrame:
    """Generate product metadata distributed across categories.

    Products are distributed evenly across the five categories. Each product
    gets a shelf life sampled uniformly from the category's range.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration with num_skus_per_store.
    rng : np.random.Generator
        Random generator for reproducible shelf-life sampling.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: sku, productName, category, baseShelfLifeDays,
        storageRequirement.
    """
    categories = list(CATEGORY_CONFIG.keys())
    num_products = config.num_skus_per_store
    records = []

    for i in range(num_products):
        category = categories[i % len(categories)]
        cat_config = CATEGORY_CONFIG[category]
        shelf_life_min, shelf_life_max = cat_config["shelf_life_range"]

        # Sample shelf life uniformly within the category range
        base_shelf_life = int(
            rng.integers(shelf_life_min, shelf_life_max + 1)
        )

        # Pick product name from templates, cycling if needed
        name_list = PRODUCT_NAMES[category]
        product_name = name_list[(i // len(categories)) % len(name_list)]

        sku = f"SKU-{i + 1:04d}"
        records.append(
            {
                "sku": sku,
                "productName": product_name,
                "category": category,
                "baseShelfLifeDays": base_shelf_life,
                "storageRequirement": cat_config["storage_requirement"],
            }
        )

    return pd.DataFrame(records)


def _generate_batches(
    config: PipelineConfig,
    products_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate batch metadata with production and expiry dates.

    Multiple batches are generated per SKU over the simulation period.
    Batch frequency depends on the product's shelf life — shorter shelf life
    products get more frequent batches.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration with num_days.
    products_df : pd.DataFrame
        Products DataFrame with sku, baseShelfLifeDays columns.
    rng : np.random.Generator
        Random generator for reproducible date and quantity sampling.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: batchId, sku, productionDate, expiryDate,
        quantityUnits.
    """
    # Simulation starts from a fixed reference date
    sim_start = datetime(2024, 1, 1)
    sim_days = config.num_days

    records = []
    batch_counter = 0

    for _, product in products_df.iterrows():
        sku = product["sku"]
        shelf_life = product["baseShelfLifeDays"]

        # Determine batch frequency: new batch every (shelf_life // 2) days,
        # minimum every 1 day for very short shelf life products
        batch_interval = max(1, shelf_life // 2)

        # Generate batches starting before sim_start to have existing inventory
        # Start one shelf_life period before simulation
        first_production = sim_start - timedelta(days=shelf_life)
        current_date = first_production

        end_date = sim_start + timedelta(days=sim_days)

        while current_date < end_date:
            batch_counter += 1
            batch_id = f"BATCH-{batch_counter:06d}"

            production_date = current_date
            expiry_date = production_date + timedelta(days=shelf_life)

            # Quantity between 20 and 200 units
            quantity = int(rng.integers(20, 201))

            records.append(
                {
                    "batchId": batch_id,
                    "sku": sku,
                    "productionDate": production_date.strftime("%Y-%m-%d"),
                    "expiryDate": expiry_date.strftime("%Y-%m-%d"),
                    "quantityUnits": quantity,
                }
            )

            # Advance by batch interval with some jitter
            jitter = int(rng.integers(0, max(1, batch_interval // 3) + 1))
            current_date += timedelta(days=batch_interval + jitter)

    return pd.DataFrame(records)


def _generate_inventory_placements(
    config: PipelineConfig,
    batches_df: pd.DataFrame,
    products_df: pd.DataFrame,
    stores_df: pd.DataFrame,
    zones_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate inventory placements linking batches to store zones.

    Each batch is placed in the appropriate zone type based on the product's
    storage requirement. Batches are distributed across stores.

    Parameters
    ----------
    config : PipelineConfig
        Pipeline configuration.
    batches_df : pd.DataFrame
        Batches DataFrame with batchId, sku, productionDate columns.
    products_df : pd.DataFrame
        Products DataFrame with sku, storageRequirement columns.
    stores_df : pd.DataFrame
        Stores DataFrame with storeCode column.
    zones_df : pd.DataFrame
        Zones DataFrame with zoneCode, storeCode, zoneType columns.
    rng : np.random.Generator
        Random generator for reproducible placement.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: placementId, batchId, storeCode, zoneCode,
        placedAt, quantityPlaced.
    """
    # Build lookup: sku -> storageRequirement
    sku_to_storage = dict(
        zip(products_df["sku"], products_df["storageRequirement"])
    )

    # Build lookup: (storeCode, zoneType) -> zoneCode
    zone_lookup = {}
    for _, zone in zones_df.iterrows():
        key = (zone["storeCode"], zone["zoneType"])
        zone_lookup[key] = zone["zoneCode"]

    store_codes = stores_df["storeCode"].tolist()
    num_stores = len(store_codes)

    records = []
    placement_counter = 0

    for _, batch in batches_df.iterrows():
        batch_id = batch["batchId"]
        sku = batch["sku"]
        production_date = batch["productionDate"]
        quantity = batch["quantityUnits"]

        storage_req = sku_to_storage[sku]

        # Distribute batches across stores (round-robin with some randomness)
        store_idx = int(rng.integers(0, num_stores))
        store_code = store_codes[store_idx]

        # Find the appropriate zone for this product at this store
        zone_code = zone_lookup[(store_code, storage_req)]

        # Placement happens on production date or shortly after (0-1 day delay)
        delay_hours = int(rng.integers(2, 24))
        placed_at = (
            datetime.strptime(production_date, "%Y-%m-%d")
            + timedelta(hours=delay_hours)
        )

        placement_counter += 1
        placement_id = f"PLC-{placement_counter:07d}"

        records.append(
            {
                "placementId": placement_id,
                "batchId": batch_id,
                "storeCode": store_code,
                "zoneCode": zone_code,
                "placedAt": placed_at.strftime("%Y-%m-%dT%H:%M:%S"),
                "quantityPlaced": quantity,
            }
        )

    return pd.DataFrame(records)
