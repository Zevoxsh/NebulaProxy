-- Add persistent public slugs for tunnel hostnames

ALTER TABLE tunnels
  ADD COLUMN IF NOT EXISTS public_slug VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tunnels_public_slug
  ON tunnels(public_slug);