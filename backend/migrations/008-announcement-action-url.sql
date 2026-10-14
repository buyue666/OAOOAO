-- Optional navigation target; existing announcements keep their original detail action.
ALTER TABLE oaooao_announcements
 ADD COLUMN action_url text
   CONSTRAINT oaooao_announcement_action_url_length CHECK (action_url IS NULL OR char_length(action_url) BETWEEN 1 AND 2048);
