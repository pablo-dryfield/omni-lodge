import React from 'react';
import { ComponentStory, ComponentMeta } from '@storybook/react';
import LeftSidebar from '../LeftSidebar';

const StoryParams: ComponentMeta<typeof LeftSidebar> = {
  title: 'Playground',
  component: LeftSidebar,
  subcomponents: {},
  argTypes: {},
};

export default StoryParams;

export const Playground: ComponentStory<typeof LeftSidebar> = () => <LeftSidebar />;
