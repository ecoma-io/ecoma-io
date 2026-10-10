// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { EcomaLogo } from '../../index';

/**
 * Consumer binding attribute ĐỘNG (theo state của app) phải tới được `<img>`
 * qua fallthrough ở mỗi lần render — fallthrough là đường tùy biến duy nhất
 * của component nên không được phép cache giá trị cũ.
 */
describe('EcomaLogo dynamic fallthrough', () => {
  it('propagates a dynamic class change from the consumer to the img', async () => {
    const wrapper = mount({
      components: { EcomaLogo },
      data: () => ({ cls: '' }),
      template: '<EcomaLogo :class="cls" />',
    });

    expect(wrapper.find('img').classes()).not.toContain('theme-dark');

    await wrapper.setData({ cls: 'theme-dark' });

    expect(wrapper.find('img').classes()).toContain('theme-dark');
  });

  it('propagates an aria attribute added after mount', async () => {
    const wrapper = mount({
      components: { EcomaLogo },
      data: () => ({ labelled: false }),
      template: '<EcomaLogo :aria-label="labelled ? \'brand\' : undefined" />',
    });

    expect(wrapper.find('img').attributes('aria-label')).toBeUndefined();

    await wrapper.setData({ labelled: true });

    expect(wrapper.find('img').attributes('aria-label')).toBe('brand');
  });

  it('propagates a dynamic style object change', async () => {
    const wrapper = mount({
      components: { EcomaLogo },
      data: () => ({ size: '12px' }),
      template: '<EcomaLogo :style="{ width: size }" />',
    });

    expect(wrapper.find('img').attributes('style')).toContain('12px');

    await wrapper.setData({ size: '24px' });

    expect(wrapper.find('img').attributes('style')).toContain('24px');
  });
});
