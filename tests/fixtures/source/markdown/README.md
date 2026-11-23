# Synthetic Markdown fixtures

All prose here is written for tests, not taken from a book. `source.txt` is the hand-written Pandoc Markdown source. `multivolume.atx.md` is Pandoc 2.9.2.1 output from it, and `multivolume.md` is the same file with its level 1 and 2 headings rewritten as Setext (`===` / `---` underlines):

```sh
pandoc -f markdown-auto_identifiers -t markdown --atx-headers -s source.txt -o multivolume.atx.md
```

They cover YAML front matter, Setext and ATX headings, a table of contents section, volumes, a preface chapter, a deeper section heading, footnotes collected at the end, an inline annotation, an image, a block quote, a scene break, line wrapping and an afterword. `extract.ts <file>` runs the extractor in its own process and prints the structure it found.
