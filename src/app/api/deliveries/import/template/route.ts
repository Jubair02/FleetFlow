import { db } from "@/lib/db";
import { fail, requireAdmin } from "@/lib/api-helpers";
import { assertFeature } from "@/lib/plans";
import { toCsv } from "@/lib/csv";
import { TEMPLATE_FILE_NAME, TEMPLATE_ROWS } from "@/lib/delivery-import";

// GET /api/deliveries/import/template — CSV template for bulk import (admin).
// UTF-8 with a BOM so Excel opens Bangla text correctly. Requires csv_import.
export async function GET() {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, "csv_import");
    return new Response("﻿" + toCsv(TEMPLATE_ROWS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${TEMPLATE_FILE_NAME}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
