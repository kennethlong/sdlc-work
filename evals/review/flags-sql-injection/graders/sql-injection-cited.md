---
type: regex
target: { source: file, path: .sdlc/reviews/feature-SHOP-42-order-search.md }
pattern: 'file:\s*src/orders/search\.ts\s*\n\s*line:\s*(7|8|9|10)\b[\s\S]{0,400}(sql|inject)'
flags: i
---
