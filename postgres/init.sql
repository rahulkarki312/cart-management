-- Create all tables
CREATE TABLE inventory_category (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES inventory_category(id) ON DELETE RESTRICT,
    name VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(55) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    level SMALLINT NOT NULL DEFAULT 0
);
CREATE TABLE inventory_product (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES inventory_category(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(55) NOT NULL UNIQUE,
    description TEXT,
    is_digital BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP,
    price NUMERIC(10,2) NOT NULL
);

-- Load data into tables
COPY inventory_category (id, parent_id, name, slug, is_active, level)
FROM '/data/category.csv'
DELIMITER ','
CSV HEADER;

COPY inventory_product (id, category_id, name, slug, description, is_digital, is_active, created_at, updated_at, price)
FROM '/data/product.csv'
DELIMITER ','
CSV HEADER;