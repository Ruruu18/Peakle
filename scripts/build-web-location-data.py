"""Build the browser-only Philippine city index from pinned geoBoundaries files.

Usage: python3 scripts/build-web-location-data.py municipalities.geojson regions.geojson provinces.geojson
Source/licence metadata is retained in the generated file and attribution page.
No geometry simplification is performed here; coordinates are rounded to 6 decimals.
"""
import json
import sys
from pathlib import Path


def polygons(geometry):
    return [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']


def in_ring(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


def contains(point, shape):
    return any(in_ring(point, p[0]) and not any(in_ring(point, hole) for hole in p[1:]) for p in shape)


def bounds(shape):
    points = [point for polygon in shape for ring in polygon for point in ring]
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]


def interior_point(shape):
    # A scan line through each polygon finds an interior point, including holes.
    # Choose the widest interior span rather than a centroid that may lie at sea.
    best = None
    for polygon in shape:
        box = bounds([polygon])
        y = (box[1] + box[3]) / 2 + 1e-10
        crossings = sorted(a[0] + (y-a[1])*(b[0]-a[0])/(b[1]-a[1])
                           for ring in polygon for a, b in zip(ring, ring[1:] + ring[:1])
                           if (a[1] > y) != (b[1] > y))
        for left, right in zip(crossings[::2], crossings[1::2]):
            if best is None or right-left > best[0]:
                best = (right-left, [(left+right)/2, y])
    if not best or not contains(best[1], shape):
        raise ValueError('No interior reference point')
    return best[1]


def load(filename):
    return [(f['properties']['shapeName'], polygons(f['geometry'])) for f in json.loads(Path(filename).read_text())['features']]


municipalities, regions, provinces = map(load, sys.argv[1:4])
region_names = dict(zip(
    ['Ilocos Region', 'Cagayan Valley', 'Central Luzon', 'Calabarzon', 'Mimaropa', 'Bicol Region', 'Western Visayas', 'Central Visayas', 'Eastern Visayas', 'Zamboanga Peninsula', 'Northern Mindanao', 'Davao Region', 'Soccsksargen', 'Caraga', 'ARMM'],
    ['Region I', 'Region II', 'Region III', 'Region IV-A', 'Region IV-B', 'Region V', 'Region VI', 'Region VII', 'Region VIII', 'Region IX', 'Region X', 'Region XI', 'Region XII', 'Region XIII', 'BARMM']))
areas = []
manila_districts = {'Binondo', 'Ermita', 'Intramuros', 'Malate', 'Paco', 'Pandacan', 'Port Area', 'Quiapo', 'Sampaloc', 'San Andres', 'San Miguel', 'San Nicolas', 'Santa Ana', 'Santa Cruz', 'Santa Mesa', 'Tondo I / II'}
manila = []
for name, shape in municipalities:
    point = interior_point(shape)
    region = next((name for name, polygon in regions if contains(point, polygon)), '')
    province = next((name for name, polygon in provinces if contains(point, polygon)), '')
    if region == 'NCR' and name in manila_districts:
        manila.extend(shape)
        continue
    city = name.removeprefix('City of ')
    if city.endswith(' City') and region == 'NCR':
        city = city[:-5]
    short_region = region_names.get(region, region)
    areas.append({'city': city, 'region': short_region, 'province': province if region != 'NCR' else '', 'polygons': shape})
if manila:
    areas.append({'city': 'Manila', 'region': 'NCR', 'province': '', 'polygons': manila})

for index, area in enumerate(areas):
    area['id'] = str(index)
    area['center'] = [round(c, 6) for c in interior_point(area['polygons'])]
    area['bounds'] = [round(c, 6) for c in bounds(area['polygons'])]
    area['polygons'] = [[[[round(c, 6) for c in point] for point in ring] for ring in poly] for poly in area['polygons']]

output = Path('public/location/ph-areas-v1.json')
output.write_text(json.dumps({'version': 1, 'boundaryYear': 2020, 'source': 'NAMRIA / PSA / OCHA, via geoBoundaries gbOpen', 'licence': 'CC BY 3.0 IGO', 'boundaryBufferMeters': 150, 'areas': areas}, ensure_ascii=False, separators=(',', ':')))
print(f'{len(areas)} areas; {output.stat().st_size:,} bytes')
print('Regions missing:', [a['city'] for a in areas if not a['region']])
