import json

with open('test_feed_result.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print("Execution time:", d['timeMs'], "ms")
print("Total videos collected:", d['totalCollected'])
print("Channel breakdown:")
for k, v in d['byChannel'].items():
    print(f"  Channel {k}: {v} videos")

print("\nSample 15 videos:")
for i, item in enumerate(d['sample'][:15]):
    print(f"{i+1}. [{item['author']}] {item['title'][:60]} ({item['dur']})")
