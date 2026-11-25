import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

export const vehicles = cf.table(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    modelId: text("model_id").notNull(),
    /** yoldayken null */
    cityId: text("city_id"),
    status: text("status").$type<"idle" | "in_transit" | "sold">().notNull().default("idle"),
    garageFacilityId: uuid("garage_facility_id"),
    currentShipmentId: uuid("current_shipment_id"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("vehicles_company_idx").on(t.companyId), index("vehicles_city_idx").on(t.cityId, t.status)],
);

export const shipments = cf.table(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id").notNull(),
    modelId: text("model_id").notNull(),
    carrierCompanyId: uuid("carrier_company_id").notNull(),
    purpose: text("purpose").$type<"own" | "freight_job" | "reposition">().notNull(),
    freightJobId: uuid("freight_job_id"),
    originCityId: text("origin_city_id").notNull(),
    destCityId: text("dest_city_id").notNull(),
    distanceKm: integer("distance_km").notNull(),
    capacityKg: bigint("capacity_kg", { mode: "number" }).notNull(),
    departedAt: timestamp("departed_at", { withTimezone: true }).notNull(),
    arrivesAt: timestamp("arrives_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    status: text("status").$type<"in_transit" | "delivered">().notNull().default("in_transit"),
    fuelCost: bigint("fuel_cost", { mode: "bigint" }).notNull(),
    driverCost: bigint("driver_cost", { mode: "bigint" }).notNull(),
    departTransactionId: uuid("depart_transaction_id"),
    arriveTransactionId: uuid("arrive_transaction_id"),
    proof: jsonb("proof"),
  },
  (t) => [
    index("shipments_due_idx").on(t.arrivesAt).where(sql`status = 'in_transit'`),
    index("shipments_carrier_idx").on(t.carrierCompanyId, t.departedAt),
  ],
);

export const shipmentCargo = cf.table(
  "shipment_cargo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    ownerCompanyId: uuid("owner_company_id").notNull(),
    consigneeCompanyId: uuid("consignee_company_id").notNull(),
    productId: text("product_id").notNull(),
    quality: integer("quality").notNull(),
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull(),
    /** yüklemede stoktan çıkan maliyet (yoldaki stok değeri) */
    costBasis: bigint("cost_basis", { mode: "bigint" }).notNull(),
    /** bu satıra düşen navlun (sahibinin ödediği) */
    freightAllocated: bigint("freight_allocated", { mode: "bigint" }).notNull().default(sql`0`),
    installmentId: uuid("installment_id"),
  },
  (t) => [index("cargo_shipment_idx").on(t.shipmentId), index("cargo_owner_idx").on(t.ownerCompanyId)],
);

export const freightJobs = cf.table(
  "freight_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").$type<"open" | "assigned" | "in_transit" | "delivered" | "expired" | "cancelled">().notNull().default("open"),
    isSystem: boolean("is_system").notNull().default(false),
    shipperCompanyId: uuid("shipper_company_id").notNull(),
    consigneeCompanyId: uuid("consignee_company_id").notNull(),
    originCityId: text("origin_city_id").notNull(),
    destCityId: text("dest_city_id").notNull(),
    distanceKm: integer("distance_km").notNull(),
    cargo: jsonb("cargo").$type<Array<{ productId: string; quality: number; qtyKg: number }>>().notNull(),
    totalKg: bigint("total_kg", { mode: "number" }).notNull(),
    payAmount: bigint("pay_amount", { mode: "bigint" }).notNull(),
    installmentId: uuid("installment_id"),
    allowSystemCarrier: boolean("allow_system_carrier").notNull().default(true),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    carrierCompanyId: uuid("carrier_company_id"),
    shipmentId: uuid("shipment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("freight_status_idx").on(t.status, t.originCityId),
    index("freight_shipper_idx").on(t.shipperCompanyId),
    index("freight_carrier_idx").on(t.carrierCompanyId),
    check("freight_pay_pos", sql`pay_amount > 0`),
  ],
);

