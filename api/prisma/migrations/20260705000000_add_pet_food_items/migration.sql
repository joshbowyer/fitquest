-- Pet food ShopItems. Seeded into the same table as Vital Tonic,
-- War Tincture, etc. — the existing /shop/items endpoint picks
-- them up automatically. The /pet/feed endpoint matches them to
-- the user's pet by effectKey suffix (pet_food_<species>):
--   kibble        → effectKey pet_food_dog        → matches species="dog"
--   rainbow_worms → effectKey pet_food_amphibian  → matches species="amphibian"
--
-- Each is 10g (matches the prior /pet/feed gold cost), one-shot
-- (effectDurationSec=NULL), and stored as a Purchase row until
-- the user feeds it via /pet/feed (which consumes unconsumed rows).

INSERT INTO "ShopItem" ("id", "key", "name", "description", "cost", "effectKey", "effectValue", "effectDurationSec", "active", "createdAt") VALUES
    ('shop_kibble',        'kibble',        'Premium Kibble',  'Crunchy bites for any dog. Each one feeds your companion for +1 XP.',                                  10, 'pet_food_dog',        1, NULL, true, CURRENT_TIMESTAMP),
    ('shop_rainbow_worms', 'rainbow_worms', 'Rainbow Worms',   'Tiny wriggling treats for your water dragon. Each one feeds your axolotl for +1 XP.',                10, 'pet_food_amphibian', 1, NULL, true, CURRENT_TIMESTAMP);