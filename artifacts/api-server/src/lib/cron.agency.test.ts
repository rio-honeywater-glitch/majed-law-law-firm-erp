import assert from "node:assert/strict";
import test from "node:test";
import {
  agencyAlertRelatedEntityType,
  getAgencyAlertStage,
} from "./cron";

test("maps only the four agency expiration alert stages", () => {
  assert.equal(getAgencyAlertStage(7)?.key, "before_7");
  assert.equal(getAgencyAlertStage(3)?.key, "before_3");
  assert.equal(getAgencyAlertStage(0)?.key, "expires_today");
  assert.equal(getAgencyAlertStage(-2)?.key, "expired_2");
  assert.equal(getAgencyAlertStage(1), null);
  assert.equal(getAgencyAlertStage(-1), null);
});

test("repeated runs use the same deduplication key", () => {
  const first = agencyAlertRelatedEntityType(
    "before_7",
    "2026-09-03",
    "AGENCY-1",
    "خدمات الموثقين",
  );
  const repeated = agencyAlertRelatedEntityType(
    "before_7",
    "2026-09-03",
    "AGENCY-1",
    "خدمات الموثقين",
  );
  assert.equal(first, repeated);
});

test("a renewed or replaced agency gets a new alert sequence", () => {
  const original = agencyAlertRelatedEntityType(
    "before_7",
    "2026-09-03",
    "AGENCY-1",
    "خدمات الموثقين",
  );
  const renewedDate = agencyAlertRelatedEntityType(
    "before_7",
    "2027-09-03",
    "AGENCY-1",
    "خدمات الموثقين",
  );
  const replacedNumber = agencyAlertRelatedEntityType(
    "before_7",
    "2026-09-03",
    "AGENCY-2",
    "خدمات الموثقين",
  );
  assert.notEqual(original, renewedDate);
  assert.notEqual(original, replacedNumber);
});