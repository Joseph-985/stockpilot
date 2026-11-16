import { render, screen } from '@testing-library/react-native';

import { TextField } from '../../../shared/ui/TextField';

describe('TextField', () => {
  it('provides an accessible name and error message', () => {
    render(<TextField label="Store name" errorMessage="Enter a store name" />);

    expect(screen.getByLabelText('Store name')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a store name');
  });
});
