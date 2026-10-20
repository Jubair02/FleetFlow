import { destroySession } from "@/lib/auth";
import { fail, ok } from "@/lib/api-helpers";

export async function POST() {
  try {
    await destroySession();
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
