-- Four-view reviews cannot silently satisfy the new eight-view review policy.
-- Keep images, polygon geometry, review history and frozen exports intact.
UPDATE events SET revision = revision + 1
WHERE id IN (SELECT event_id FROM reviews UNION SELECT event_id FROM planning_runs);
UPDATE planning_runs SET stale = 1;
-- This also prevents a still-running older worker from reusing a four-view approval.
UPDATE reviews SET status = 'stale', stale_reason = 'Screening coverage expanded. Review all eight views.'
WHERE COALESCE(json_extract(evidence, '$.transformVersion'), '') <> 'screening-srgb-eight-views-v2';
