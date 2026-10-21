import { fail, requireAdmin } from "@/lib/api-helpers";
import { toCsv } from "@/lib/csv";
import { TEMPLATE_FILE_NAME, TEMPLATE_ROWS } from "@/lib/delivery-import";

// GET /api/deliveries/import/template — CSV template for bulk import (admin).
// UTF-8 with a BOM so Excel opens Bangla text correctly.
export async function GET() {
  try {
    await requireAdmin();
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
