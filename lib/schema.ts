export const SCHEMA = `
-- PayNudge schema (Postgres / Supabase). Safe to run more than once.

create table if not exists customers (
  id            serial primary key,
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  created_at    timestamptz not null default now()
);
create unique index if not exists customers_name_key on customers (lower(name));

create table if not exists invoices (
  id              serial primary key,
  customer_id     integer not null references customers(id) on delete cascade,
  invoice_number  text not null unique,
  amount          double precision not null check (amount > 0),
  issue_date      text,                       -- YYYY-MM-DD
  due_date        text not null,              -- YYYY-MM-DD
  status          text not null default 'open' check (status in ('open','claimed','paid')),
  paid_on         text,                       -- YYYY-MM-DD
  payment_ref     text,
  priority        text check (priority in ('low','medium','high')),
  strategy_note   text,
  notes           text,
  public_token    text not null unique,
  created_by      text not null default 'user',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists reminders (
  id          serial primary key,
  invoice_id  integer not null references invoices(id) on delete cascade,
  send_on     text not null,                  -- YYYY-MM-DD
  channel     text not null default 'email' check (channel in ('email','whatsapp')),
  tone        text not null default 'friendly' check (tone in ('friendly','firm','final')),
  subject     text,
  message     text not null,
  status      text not null default 'scheduled' check (status in ('scheduled','sent','cancelled')),
  delivery    text,                           -- how it was delivered (real / simulated)
  sent_at     timestamptz,
  created_by  text not null default 'user',
  created_at  timestamptz not null default now()
);
create index if not exists reminders_due_idx on reminders (status, send_on);

create table if not exists activity (
  id          serial primary key,
  invoice_id  integer references invoices(id) on delete cascade,
  actor       text not null check (actor in ('claude','user','customer','system')),
  action      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists activity_invoice_idx on activity (invoice_id, created_at desc);
`;
