/**
 * Minimal, dependency-free XML reader for `svn --xml` output.
 *
 * The plugin ships no third-party runtime dependencies, and Subversion's XML
 * output is a small, well-formed subset: elements, quoted attributes, text
 * nodes with predefined/numeric entities and — defensively — comments,
 * CDATA and a DOCTYPE. This is deliberately not a general XML implementation:
 * it ignores declarations and processing instructions, supports no
 * namespaces, and enforces depth and node-count bounds so hostile or corrupt
 * output cannot exhaust memory. Malformed input raises {@link XmlParseError},
 * which callers translate into a safe `operation-failed` result; no raw
 * document text is ever copied into an error message.
 * @module dsh-vcs-timeline/host/adapters/svn/xml
 */

/** One parsed element. `text` is the element's own decoded text content. */
export interface XmlNode {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

/** Raised for input this reader cannot parse. */
export class XmlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlParseError'
  }
}

/** Maximum element nesting accepted. */
const MAX_DEPTH = 64

/** Maximum number of elements accepted in one document. */
const MAX_NODES = 200_000

/** Predefined XML entities. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * Decode predefined and numeric XML entities; unknown entities are kept
 * verbatim so a future entity cannot silently corrupt a path.
 * @param raw - raw text from the document.
 * @returns decoded text.
 */
export function decodeXmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&(#(?:[xX])?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9._-]*);/g, (match: string, entity: string) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity.startsWith('#x') || entity.startsWith('#X')
      const digits = hexadecimal ? entity.slice(2) : entity.slice(1)
      const code = Number.parseInt(digits, hexadecimal ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[entity] ?? match
  })
}

/** Whether a character is XML whitespace. */
function isXmlSpace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

/** Read an element or attribute name starting at `start`. */
function readName(source: string, start: number): { name: string; end: number } {
  let index = start
  while (index < source.length) {
    const character = source[index] as string
    if (character === '>' || character === '/' || isXmlSpace(character)) break
    if (character === '<') throw new XmlParseError('unexpected < inside a tag')
    index += 1
  }
  const name = source.slice(start, index)
  if (name === '') throw new XmlParseError('element name is missing')
  return { name, end: index }
}

/** One parsed open or self-closing tag. */
interface OpenTag {
  name: string
  attributes: Record<string, string>
  selfClosing: boolean
  end: number
}

/** Parse an open/self-closing tag whose name starts at `start` (after `<`). */
function parseOpenTag(source: string, start: number): OpenTag {
  const { name, end } = readName(source, start)
  let index = end
  const attributes: Record<string, string> = {}
  while (index < source.length) {
    while (index < source.length && isXmlSpace(source[index] as string)) index += 1
    if (index >= source.length) throw new XmlParseError(`unterminated tag <${name}>`)
    const character = source[index] as string
    if (character === '>') return { name, attributes, selfClosing: false, end: index + 1 }
    if (character === '/') {
      if (source[index + 1] === '>') return { name, attributes, selfClosing: true, end: index + 2 }
      throw new XmlParseError(`malformed self-closing tag <${name}>`)
    }
    const nameStart = index
    while (index < source.length) {
      const candidate = source[index] as string
      if (candidate === '=' || candidate === '>' || candidate === '/' || isXmlSpace(candidate)) break
      index += 1
    }
    const attributeName = source.slice(nameStart, index)
    if (attributeName === '') throw new XmlParseError(`malformed attribute in <${name}>`)
    while (index < source.length && isXmlSpace(source[index] as string)) index += 1
    if (source[index] !== '=') throw new XmlParseError(`attribute "${attributeName}" in <${name}> has no value`)
    index += 1
    while (index < source.length && isXmlSpace(source[index] as string)) index += 1
    const quote = source[index]
    if (quote !== '"' && quote !== "'") throw new XmlParseError(`attribute "${attributeName}" in <${name}> is not quoted`)
    index += 1
    const valueEnd = source.indexOf(quote, index)
    if (valueEnd === -1) throw new XmlParseError(`unterminated attribute value in <${name}>`)
    attributes[attributeName] = decodeXmlEntities(source.slice(index, valueEnd))
    index = valueEnd + 1
  }
  throw new XmlParseError(`unterminated tag <${name}>`)
}

/** Parse a closing tag whose name starts at `start` (after `</`). */
function parseCloseTag(source: string, start: number): { name: string; end: number } {
  const { name, end } = readName(source, start)
  let index = end
  while (index < source.length && isXmlSpace(source[index] as string)) index += 1
  if (source[index] !== '>') throw new XmlParseError(`malformed closing tag </${name}>`)
  return { name, end: index + 1 }
}

/** Skip a `<!...>` declaration, tolerating an internal `[ ... ]` subset. */
function skipDeclaration(source: string, start: number): number {
  let index = start
  let bracketDepth = 0
  while (index < source.length) {
    const character = source[index] as string
    if (character === '[') bracketDepth += 1
    else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (character === '>' && bracketDepth === 0) return index + 1
    index += 1
  }
  throw new XmlParseError('unterminated declaration')
}

/**
 * Parse one XML document.
 * @param source - complete document text.
 * @returns a synthetic `#document` node whose single child is the root.
 * @throws {XmlParseError} when the document is not well-formed within the
 *   supported subset.
 */
export function parseXml(source: string): XmlNode {
  if (typeof source !== 'string') throw new XmlParseError('XML source must be a string')
  const document: XmlNode = { name: '#document', attributes: {}, children: [], text: '' }
  const stack: XmlNode[] = [document]
  let position = 0
  let nodeCount = 0

  const appendText = (raw: string): void => {
    if (raw === '') return
    const top = stack[stack.length - 1] as XmlNode
    if (top === document) {
      if (raw.trim() !== '') throw new XmlParseError('text outside the document element')
      return
    }
    top.text += decodeXmlEntities(raw)
  }

  while (position < source.length) {
    const open = source.indexOf('<', position)
    if (open === -1) {
      appendText(source.slice(position))
      break
    }
    appendText(source.slice(position, open))
    position = open

    if (source.startsWith('<?', position)) {
      const end = source.indexOf('?>', position + 2)
      if (end === -1) throw new XmlParseError('unterminated processing instruction')
      position = end + 2
      continue
    }
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4)
      if (end === -1) throw new XmlParseError('unterminated comment')
      position = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', position)) {
      const end = source.indexOf(']]>', position + 9)
      if (end === -1) throw new XmlParseError('unterminated CDATA section')
      const top = stack[stack.length - 1] as XmlNode
      if (top === document) throw new XmlParseError('CDATA outside the document element')
      top.text += source.slice(position + 9, end)
      position = end + 3
      continue
    }
    if (source.startsWith('<!', position)) {
      position = skipDeclaration(source, position + 2)
      continue
    }
    if (source.startsWith('</', position)) {
      const closing = parseCloseTag(source, position + 2)
      const current = stack.pop()
      if (current === undefined || current === document) throw new XmlParseError(`unexpected closing tag </${closing.name}>`)
      if (current.name !== closing.name) throw new XmlParseError(`mismatched closing tag </${closing.name}>; expected </${current.name}>`)
      position = closing.end
      continue
    }

    const tag = parseOpenTag(source, position + 1)
    nodeCount += 1
    if (nodeCount > MAX_NODES) throw new XmlParseError('XML document has too many elements')
    const parent = stack[stack.length - 1] as XmlNode
    const node: XmlNode = { name: tag.name, attributes: tag.attributes, children: [], text: '' }
    parent.children.push(node)
    if (!tag.selfClosing) {
      if (stack.length + 1 > MAX_DEPTH) throw new XmlParseError('XML document is nested too deeply')
      stack.push(node)
    }
    position = tag.end
  }

  if (stack.length !== 1) {
    const openElement = stack[stack.length - 1] as XmlNode
    throw new XmlParseError(`unclosed element <${openElement.name}>`)
  }
  if (document.children.length === 0) throw new XmlParseError('XML document has no root element')
  if (document.children.length > 1) throw new XmlParseError('XML document has multiple root elements')
  return document
}

/**
 * Read the single root element, optionally asserting its name.
 * @param document - a parsed document.
 * @param expectedName - required root element name.
 * @returns the root element.
 */
export function rootElement(document: XmlNode, expectedName?: string): XmlNode {
  const root = document.children[0]
  if (root === undefined) throw new XmlParseError('XML document has no root element')
  if (expectedName !== undefined && root.name !== expectedName) {
    throw new XmlParseError(`unexpected root element <${root.name}>; expected <${expectedName}>`)
  }
  return root
}

/**
 * Direct child elements, optionally filtered by name.
 * @param node - parent element.
 * @param name - optional element name filter.
 * @returns matching children in document order.
 */
export function childElements(node: XmlNode, name?: string): XmlNode[] {
  return name === undefined ? [...node.children] : node.children.filter(child => child.name === name)
}

/**
 * First direct child element with the given name.
 * @param node - parent element.
 * @param name - element name.
 * @returns the first match, if any.
 */
export function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find(child => child.name === name)
}

/**
 * Trimmed text of the first child element with the given name.
 * @param node - parent element.
 * @param name - child element name.
 * @returns the trimmed text, or undefined when the child is absent or empty.
 */
export function childText(node: XmlNode, name: string): string | undefined {
  const child = firstChild(node, name)
  if (child === undefined) return undefined
  const text = child.text.trim()
  return text === '' ? undefined : text
}

/**
 * Trimmed attribute value.
 * @param node - element carrying the attribute.
 * @param name - attribute name.
 * @returns the trimmed value, or undefined when absent or empty.
 */
export function attributeText(node: XmlNode, name: string): string | undefined {
  const value = node.attributes[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
