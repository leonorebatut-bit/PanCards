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

export interface UserCardCopy {
  id: string;
  user_id: string;
  card_id: number;
  acquired_at: string;
  source: 'booster' | 'trade' | 'admin' | 'starter';
  card: Card;
}

export interface CollectionFolder {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface CollectionCardLink {
  collection_id: string;
  card_id: number;
  added_at: string;
}

export interface ShowcaseItem {
  user_id: string;
  card_id: number;
  position: number;
  card: Card;
}
