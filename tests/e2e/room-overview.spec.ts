import { test } from "@playwright/test";

// v3.5 room overview (D2): owned by P4 (PLAN A11). Placeholder from W0 so the file and its imports exist.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

test.fixme("room overview (D2): tests land with P4", async () => {});
