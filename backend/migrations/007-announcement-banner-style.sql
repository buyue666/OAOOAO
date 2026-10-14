-- Add presentation preferences without rewriting notice content or schedule instants.
ALTER TABLE oaooao_announcements
 ADD COLUMN banner_tone text NOT NULL DEFAULT 'promo'
   CONSTRAINT oaooao_announcement_banner_tone CHECK (banner_tone IN ('promo','info','warning','violet','rose','slate')),
 ADD COLUMN banner_effect text NOT NULL DEFAULT 'glow'
   CONSTRAINT oaooao_announcement_banner_effect CHECK (banner_effect IN ('none','glow','shimmer'));
