# OpenLineage sample events

`metadata.json` holds 26 OpenLineage `RunEvent`s (13 runs, each with a `START` and a `COMPLETE`)
from the public Marquez seed data: a small "food delivery" pipeline with eight extract jobs, five
derived tables, and two consuming jobs. `config/examples/openlineage.yaml` renders it.

## Provenance

| Field             | Value                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Project           | [Marquez](https://github.com/MarquezProject/marquez) (`MarquezProject/marquez`)                                                 |
| License           | Apache-2.0 (repository `LICENSE`; `docker/seed.sh` carries `SPDX-License-Identifier: Apache-2.0`)                               |
| Upstream file     | `docker/metadata.template.json`                                                                                                 |
| Commit            | `180f37b22387146187af1ef0279e3ee1d1ccd789` (`main` on 2026-10-08)                                                               |
| URL               | https://raw.githubusercontent.com/MarquezProject/marquez/180f37b22387146187af1ef0279e3ee1d1ccd789/docker/metadata.template.json |
| Upstream SHA-256  | `f40f076faec0305a3bc3c03e7ceeedce1cdecf7b7e58df94d84b3dae6dba0073` (73,559 bytes)                                               |
| This file SHA-256 | `c18d18fb4cd3f48ce3662d13be2054c86debd99dddf0373ab51c9c28f8356cd7`                                                              |

Marquez does not commit a ready-made `docker/metadata.json`. It commits the template and its
`docker/seed.sh` renders it with the current time. The file here is that rendering, with fixed
times, which is why it is named `metadata.json` (the name `seed.sh` writes).

## Changes from upstream

Two mechanical edits, nothing else (no events added, removed, or reordered):

1. The seven time placeholders are replaced the way `seed.sh` replaces them, with a fixed "now" of
   `2020-02-22T22:00:00.000Z` (the same instant as the events' own `nominalStartTime`):
   `{{RUN_START_TIME}}` becomes `2020-02-22T22:00:00.000Z`, and
   `{{RUN_END_TIME_AFTER_N_MINUTES}}` becomes `2020-02-22T22:0N:00.000Z` (`N` is 5 to 9, and 10
   becomes `22:10:00`).
2. The demo database address `postgres://food_delivery:food_delivery@postgres:5432/food_delivery`
   (Marquez's docker-compose user and password) becomes `postgres://postgres:5432/food_delivery`,
   so no `user:password@` string sits in this repository.

To reproduce, run `sed` over the upstream file:

```sh
sed -e 's/{{RUN_START_TIME}}/2020-02-22T22:00:00.000Z/' \
    -e 's/{{RUN_END_TIME_AFTER_5_MINUTES}}/2020-02-22T22:05:00.000Z/' \
    -e 's/{{RUN_END_TIME_AFTER_6_MINUTES}}/2020-02-22T22:06:00.000Z/' \
    -e 's/{{RUN_END_TIME_AFTER_7_MINUTES}}/2020-02-22T22:07:00.000Z/' \
    -e 's/{{RUN_END_TIME_AFTER_8_MINUTES}}/2020-02-22T22:08:00.000Z/' \
    -e 's/{{RUN_END_TIME_AFTER_9_MINUTES}}/2020-02-22T22:09:00.000Z/' \
    -e 's/{{RUN_END_TIME_AFTER_10_MINUTES}}/2020-02-22T22:10:00.000Z/' \
    -e 's#postgres://food_delivery:food_delivery@postgres:5432/food_delivery#postgres://postgres:5432/food_delivery#' \
    metadata.template.json > metadata.json
```

The file is 73 KB, well under the 2 MB limit for keeping a sample whole, so nothing is subset.

## Personal data check

The sample has no real people, addresses, or accounts. Column names such as `email` and `phone`
appear only as schema field names and generic descriptions ("The email address of the customer."),
and SQL text refers to tables, not values. The names in it (`food_delivery`, `public.menus`,
`etl_menus`) are the upstream sample's own and are kept as they are.

The sample is used as test data and as the demo data of `config/examples/openlineage.yaml`. It is
not loaded unless that config (or your own config naming the file) is used.
