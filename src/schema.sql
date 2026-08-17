-- Requires PostGIS for geospatial indexing:
-- CREATE EXTENSION IF NOT EXISTS postgis;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM ('customer', 'provider', 'admin');
CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
CREATE TYPE price_type AS ENUM ('fixed', 'hourly', 'quote');
CREATE TYPE request_status AS ENUM ('pending', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled', 'disputed');
CREATE TYPE payment_status AS ENUM ('authorized', 'held', 'released', 'refunded');
CREATE TYPE payout_status AS ENUM ('pending', 'paid');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provider_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  verification_docs JSONB,
  stripe_account_id TEXT,                    -- Stripe Connect account for payouts
  base_lat DOUBLE PRECISION,
  base_lng DOUBLE PRECISION,
  live_lat DOUBLE PRECISION,
  live_lng DOUBLE PRECISION,
  live_location_updated_at TIMESTAMPTZ,
  service_radius_km REAL DEFAULT 10,
  available_now BOOLEAN NOT NULL DEFAULT false,
  reliability_score REAL NOT NULL DEFAULT 1.0,
  avg_rating REAL NOT NULL DEFAULT 0,
  completed_jobs INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_provider_live_location ON provider_profiles (live_lat, live_lng);

CREATE TABLE service_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES service_categories(id)
);

CREATE TABLE provider_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES service_categories(id),
  price_type price_type NOT NULL DEFAULT 'fixed',
  price NUMERIC(10,2) NOT NULL,
  UNIQUE (provider_id, category_id)
);

CREATE TABLE availability_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_availability_provider_time ON availability_slots (provider_id, start_time);

CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id),
  category_id UUID NOT NULL REFERENCES service_categories(id),
  status request_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_time TIMESTAMPTZ,
  customer_lat DOUBLE PRECISION NOT NULL,
  customer_lng DOUBLE PRECISION NOT NULL,
  customer_address TEXT NOT NULL,             -- only exposed to provider after acceptance, enforced in app code
  match_score_at_request REAL,
  quoted_price NUMERIC(10,2) NOT NULL,
  final_price NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_customer_status ON requests (customer_id, status);
CREATE INDEX idx_requests_provider_status ON requests (provider_id, status);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID UNIQUE NOT NULL REFERENCES requests(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewee_id UUID NOT NULL REFERENCES users(id),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES requests(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES requests(id),
  stripe_payment_intent_id TEXT UNIQUE,
  amount NUMERIC(10,2) NOT NULL,
  platform_fee NUMERIC(10,2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'authorized',
  provider_payout_status payout_status NOT NULL DEFAULT 'pending',
  processed_at TIMESTAMPTZ
);

-- Audit log for sensitive status/payout changes (needed for dispute resolution)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
