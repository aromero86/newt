import type { ReactNode } from 'react'
import {
  Card as ShadcnCard,
  CardContent as ShadcnCardContent,
  CardDescription as ShadcnCardDescription,
  CardFooter as ShadcnCardFooter,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
} from '../../shadcn/card'

type CardProps = {
  title?: ReactNode
  description?: ReactNode
  /** Heading level of the title, to fit the page's outline. */
  titleLevel?: 2 | 3 | 4
  /** Actions or notes at the bottom, laid out in a row. */
  footer?: ReactNode
  children?: ReactNode
}

export function Card({ title, description, titleLevel = 3, footer, children }: CardProps) {
  const hasHeader = title !== undefined || description !== undefined
  return (
    <ShadcnCard>
      {hasHeader && (
        <ShadcnCardHeader>
          {title !== undefined && (
            <ShadcnCardTitle role="heading" aria-level={titleLevel}>
              {title}
            </ShadcnCardTitle>
          )}
          {description !== undefined && <ShadcnCardDescription>{description}</ShadcnCardDescription>}
        </ShadcnCardHeader>
      )}
      {/* Cards side by side share a height: the content grows, so footers line up. */}
      {children !== undefined && <ShadcnCardContent className="flex-1">{children}</ShadcnCardContent>}
      {footer !== undefined && <ShadcnCardFooter className="mt-auto flex-wrap gap-2">{footer}</ShadcnCardFooter>}
    </ShadcnCard>
  )
}
