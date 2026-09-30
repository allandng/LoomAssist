/**
 * LoomAssist UI kit — import everything visual from here.
 *
 *   import { Button, IconButton, Field, Input, Select, Switch, Checkbox,
 *            Card, CardHeader, CardBody, CardFooter,
 *            Page, PageHeader, Section, EmptyState, Toolbar, StatTile, Row,
 *            Segmented, Tabs, Badge, Avatar, ProgressRing, ProgressBar,
 *            Spinner, Skeleton, Tooltip, Menu, Popover,
 *            confirm, prompt, DialogHost,
 *            Icon, Icons, Kbd, Chip, TLDot, SectionLabel } from '../components/ui';
 */
export { Button, IconButton } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize, IconButtonProps } from './Button';

export { Field, Input, Textarea, Select, Switch, Checkbox } from './Field';
export type { FieldProps, InputProps, TextareaProps, SelectProps, SwitchProps, CheckboxProps } from './Field';

export { Card, CardHeader, CardBody, CardFooter } from './Card';
export type { CardProps, CardHeaderProps } from './Card';

export { Page, PageHeader, Section, EmptyState, Toolbar, ToolbarSpacer, ToolbarDivider, StatTile, Row } from './Layout';
export type { PageProps, PageHeaderProps, SectionProps, EmptyStateProps, StatTileProps, RowProps } from './Layout';

export { Segmented, Tabs, Badge, Avatar, ProgressRing, ProgressBar, Spinner, Skeleton, Tooltip } from './Controls';
export type { SegmentedOption, SegmentedProps, TabItem, TabsProps, BadgeProps, BadgeTone, AvatarProps, ProgressRingProps, TooltipProps } from './Controls';

export { Menu, Popover } from './Menu';
export type { MenuItem, MenuEntry, MenuProps, PopoverProps } from './Menu';

export { DialogHost } from './Dialog';
export { confirm, prompt } from './dialogStore';
export type { ConfirmOptions, PromptOptions } from './dialogStore';

/* Existing shared atoms, re-exported so one import path covers the kit. */
export { Icon, Icons } from '../shared/Icon';
export type { IconName } from '../shared/Icon';
export { Kbd } from '../shared/Kbd';
export { Chip } from '../shared/Chip';
export { TLDot } from '../shared/TLDot';
export { SectionLabel } from '../shared/SectionLabel';
