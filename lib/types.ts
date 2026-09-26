export type Article = {
  id: string;
  title: string;
  excerpt: string;
  content?: string;
  price_paise: number;
  published: boolean;
  created_at?: string;
};

export type Payment = {
  id: string;
  article_id: string;
  amount_paise: number;
  status: string;
  transaction_ref: string;
  access_token: string;
  created_at: string;
};
