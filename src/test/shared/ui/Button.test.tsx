import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '../../../shared/ui/Button';

describe('Button', () => {
  it('exposes its label and invokes its action', () => {
    const onPress = jest.fn();
    render(<Button label="Continue" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
