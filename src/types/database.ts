export interface Card {
  id: number;
  original_filename: string;
  image_url: string;
  thumb_url: string;
  description: string | null;
  extra_info: string | null;
  status: 'published' | 'pending' | 'rejected';
  uploaded_by: string | null;
  created_at: string;
  published_at: string | null;
}

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string;
  is_public: boolean;
  poubelles: number;
  boosters_stored: number;
  last_booster_tick: string;
  is_admin: boolean;
  is_suspended: boolean;
  created_at: string;
}
