/**
 * F-Y8: WebSocket close codes used by the Clawbada server. Kept in a
 * shared module so consumers (the WS hook, telemetry, analytics) reference
 * the same constants — avoids drift via redefinitions in each file.
 *
 * 1000 series codes follow the IANA WebSocket Close Code Number Registry
 * (RFC 6455 §7.4.1 and follow-ups).
 */

/** F-2H: server emits 1008 (Policy Violation) when the auth signature on
 *  the upgrade reaches its `AUTH_PAST_WINDOW_SEC` (5-min) expiry. The
 *  client's reconnect logic treats this as an auth-renewal signal —
 *  invalidates the cached signature and reconnects with a fresh sign. */
export const WS_CLOSE_SIGNATURE_EXPIRED = 1008;

/** F-Y2: server emits 1013 (Try Again Later) when the per-address
 *  concurrent-socket cap is exhausted at upgrade time. Client treats this
 *  as a transient capacity signal — reconnect with longer backoff, do NOT
 *  count toward the F-2N pre-open-failure terminal classifier. F-Y5
 *  adds a separate consecutive-capacity-failures counter so we eventually
 *  go terminal if the cap stays full for an extended period. */
export const WS_CLOSE_CAPACITY = 1013;
