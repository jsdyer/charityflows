#!/usr/bin/env python3
"""Build an indexed CRA T3010 charity directory and fiscal-period grant shards."""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date
from decimal import Decimal, InvalidOperation
import gzip
from http.client import IncompleteRead
import json
from pathlib import Path
import re
from shutil import copytree, rmtree
from tempfile import TemporaryDirectory
from time import sleep
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CDN = "https://open.canada.ca/data/dataset/"
SOURCES = {
    2022: ("b2acb3be-c720-4329-a8c0-d4d36c8db61e", ("4284197f-73f9-4c28-8e4f-56aeaf9414cf", "2436c7a6-7ad4-45d2-abea-62de613e6ef0", "af071c2f-e88d-4d9f-9d1c-173bcb161d3e")),
    2023: ("05b3abd0-e70f-4b3b-a9c5-acc436bd15b6", ("31a52caf-fa79-4ab3-bded-1ccc7b61c17f", "0b9b4b01-5cb6-4981-b007-ae88f48cc799", "c603fe1f-cc4c-480e-b1cd-7fd949c42487")),
    2024: ("80c00cdb-1358-415c-bb8b-0de7f12675b8", ("694fdc72-eae4-4ee0-83eb-832ab7b230e3", "e545170c-3689-4833-b2a8-e9e83100ab59", "8195b2cb-ce2d-4cd2-b829-6d07f4959f49")),
}
DOCUMENTS = ("ident", "financial_d_and_schedule_6", "qualified_donees")
BN = re.compile(r"[0-9]{9}RR[0-9]{4}\Z")
BUCKETS = 128
LIMIT = 110_000_000
GRANT_LIMIT = 40


def acquire(job, directory, local):
    year, which = job
    dataset, resources = SOURCES[year]
    filename = f"{DOCUMENTS[which]}_{year}_updated.csv"
    if local:
        return (year, which), directory / filename
    target = directory / filename
    url = f"{CDN}{dataset}/resource/{resources[which]}/download/{filename}"
    request = Request(url, headers={"User-Agent": "CoolCode Charity Flows build"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=90) as response, target.open("wb") as output:
                size = 0
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > LIMIT:
                        raise ValueError(f"{filename} exceeded expected size")
                    output.write(block)
            if target.stat().st_size < 1_000_000:
                raise ValueError(f"{filename} was not a complete source CSV")
            return (year, which), target
        except (URLError, TimeoutError, IncompleteRead):
            if attempt == 2:
                raise
            sleep(2 ** attempt)


def rows(path, fields):
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as stream:
        reader = csv.DictReader(stream)
        if not set(fields).issubset(reader.fieldnames or []):
            raise ValueError(f"{path.name} no longer has expected columns")
        for row in reader:
            yield tuple((row.get(k) or "").strip() for k in fields)


def number(value):
    if not value:
        return None
    try:
        n = Decimal(value.replace(",", ""))
        if n.is_finite() and abs(n) < 10**12:
            return int(n * 100)
    except InvalidOperation:
        pass
    return None


def make(files):
    identity, financials, gifts = {}, {}, defaultdict(dict)
    covered = []
    for year in SOURCES:
        n = 0
        for bn, status, name, account, city, province in rows(files[year, 0],
                ("BN", "Designation", "Legal Name", "Account Name", "City", "Province")):
            if BN.fullmatch(bn) and (name or account):
                identity[bn] = [bn, name or account, province, city, status]
                n += 1
        if n < 50_000:
            raise ValueError(f"Identification data for {year} appears incomplete")
        count = 0
        for bn, end, form, revenue, expense, assets, liabilities in rows(files[year, 1],
                ("BN", "FPE", "Form ID", "4700", "5100", "4200", "4350")):
            if bn not in identity:
                continue
            try:
                if date.fromisoformat(end).isoformat() != end:
                    continue
            except ValueError:
                continue
            key = (bn, end, form)
            if key in financials and financials[key][1] != year:
                gifts.pop(key, None)
            financials[key] = [end, year, *map(number, (revenue, expense, assets, liabilities))]
            count += 1
        if count < 50_000:
            raise ValueError(f"Financial data for {year} appears incomplete")
        covered.append([year, count])
        count = 0
        for bn, end, form, line, donee, name, total in rows(files[year, 2],
                ("BN", "FPE", "Form ID", "#", "Donee BN", "Donee Name", "Total Gifts")):
            key = (bn, end, form)
            if key not in financials or financials[key][1] != year:
                continue
            cents = number(total)
            if not cents or cents < 0 or not (donee or name):
                continue
            donee = donee if BN.fullmatch(donee) else ""
            gifts[key][line] = [donee, name, cents]
            count += 1
        if count < 25_000:
            raise ValueError(f"Donee data for {year} appears incomplete")
        print(f"{year}: {covered[-1][1]:,} financial and {count:,} matched gift rows", flush=True)

    histories = defaultdict(list)
    for key, finance in financials.items():
        grant_lines = gifts.pop(key, {})
        grouped = {}
        for line, (donee, name, value) in grant_lines.items():
            recipient = ("registered", donee) if donee else ("as filed", line)
            grant = grouped.setdefault(recipient, [donee, name, 0])
            grant[2] += value
        grants = sorted(grouped.values(), key=lambda r: (-r[2], r[1]))
        histories[key[0]].append([*finance, len(grants), sum(r[2] for r in grants), grants[:GRANT_LIMIT]])

    directory = []
    bucket = [{} for _ in range(BUCKETS)]
    for bn, history in histories.items():
        history.sort(reverse=True, key=lambda r: (r[0], r[1]))
        latest = history[0]
        directory.append([*identity[bn], latest[2], latest[0]])
        bucket[int(bn[:9]) % BUCKETS][bn] = history
    directory.sort(key=lambda row: (row[1].casefold(), row[0]))
    return directory, bucket, covered


def encode(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def publish(directory, buckets, covered):
    dist = ROOT / "dist"
    if dist.exists():
        rmtree(dist)
    copytree(ROOT / "web", dist)
    data = dist / "data"
    data.mkdir()
    index = encode(directory)
    (dist / "index.json").write_bytes(index)
    (dist / "index.json.gz").write_bytes(gzip.compress(index, mtime=0))
    (dist / "manifest.json").write_bytes(encode({
        "built": date.today().isoformat(), "charities": len(directory), "covered": covered, "buckets": BUCKETS,
        "grantLimit": GRANT_LIMIT, "sources": {yr: CDN + ds for yr, (ds, _) in SOURCES.items()},
    }))
    for num, subset in enumerate(buckets):
        (data / f"{num}.json").write_bytes(encode(subset))
    print(f"Wrote {len(directory):,} charities and {len(buckets)} detail shards", flush=True)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--input-dir", type=Path, help="Read the nine unmodified official CSV downloads")
    args = cli.parse_args()
    jobs = [(year, n) for year in SOURCES for n in range(len(DOCUMENTS))]
    with TemporaryDirectory(prefix="charity-flows-") as scratch:
        base = args.input_dir or Path(scratch)
        with ThreadPoolExecutor(max_workers=4) as pool:
            files = dict(pool.map(lambda work: acquire(work, base, args.input_dir is not None), jobs))
        publish(*make(files))


if __name__ == "__main__":
    main()
