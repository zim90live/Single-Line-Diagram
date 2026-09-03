interface InspectorHeadingProps {
  id: string
  eyebrow: string
  tag: string
  title: string
  description?: string
}

export function InspectorHeading({
  id,
  eyebrow,
  tag,
  title,
  description,
}: InspectorHeadingProps) {
  return (
    <header className="inspector-heading">
      <span>
        <small>{eyebrow}</small>
        <i>{tag}</i>
      </span>
      <h2 id={id}>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  )
}
