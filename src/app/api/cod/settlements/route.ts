import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireStaff } from "@/lib/api-helpers";
import { firstError } from "@/lib/validation";
import { TX_OPTIONS, lockDriver } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

const settleSchema = z.object({
  driverId: z.string().min(1, "Choose a driver"),
  /** The total the office counted — must match what the driver is holding. */
  expectedAmount: z.number().int().min(0),
  note: z.string().trim().max(300, "Note must be 300 characters or fewer").optional().or(z.literal("")),
});

/**
 * POST /api/cod/settlements — record a driver handing their collected cash to
 * the office. Covers every collected, unsettled delivery of that driver. The
 * client sends the total it showed; if more cash was collected in the
 * meantime the request is refused so the office never signs for the wrong sum.
 */
export async function POST(req: Request) {
  try {
    const user = await requireStaff();
    const parsed = settleSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { driverId, expectedAmount, note } = parsed.data;

    const settlement = await db.$transaction(async (tx) => {
      const driver = await tx.user.findFirst({ where: { id: driverId, organizationId: user.organizationId, role: "DRIVER" }, select: { id: true, name: true } });
      if (!driver) throw new ApiError(404, "Driver not found");
      // Serializes against the driver completing another COD job at the same moment.
      await lockDriver(tx, driver.id);

      const open = await tx.delivery.findMany({
        where: { organizationId: user.organizationId, codCollectedById: driver.id, codCollectedAt: { not: null }, codSettlementId: null },
        select: { id: true, codCollectedAmount: true },
      });
      if (open.length === 0) throw new ApiError(409, `${driver.name} isn't holding any collected cash`);
      const amount = open.reduce((s, d) => s + (d.codCollectedAmount ?? 0), 0);
      if (amount !== expectedAmount) {
        throw new ApiError(409, `${driver.name} now holds ৳${amount.toLocaleString("en-US")} — refresh and check the total before recording the handover`);
      }

      const created = await tx.codSettlement.create({
        data: {
          organizationId: user.organizationId,
          driverId: driver.id,
          amount,
          deliveryCount: open.length,
          receivedById: user.id,
          receivedByName: user.name,
          note: note || null,
        },
      });
      const updated = await tx.delivery.updateMany({
        where: { id: { in: open.map((d) => d.id) }, codSettlementId: null },
        data: { codSettlementId: created.id },
      });
      if (updated.count !== open.length) throw new ApiError(409, "The cash records changed while saving — please try again");

      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "COD_SETTLED", entityType: "CodSettlement", entityId: created.id,
          detail: { driverId: driver.id, driverName: driver.name, amount, deliveries: open.length },
        }),
      });
      return created;
    }, TX_OPTIONS);

    return ok({ success: true, settlementId: settlement.id, amount: settlement.amount, deliveryCount: settlement.deliveryCount }, 201);
  } catch (e) {
    return fail(e);
  }
}
