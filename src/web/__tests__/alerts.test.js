import { closeWebAlert, getAlert, showWebAlert } from '../alerts';

afterEach(() => { while (getAlert()) closeWebAlert(getAlert().id); });

it('runs only the selected confirmation action and ignores repeated clicks', () => {
  const finish = jest.fn();
  const cancel = jest.fn();
  showWebAlert('Finish?', 'Record this score.', [{ text: 'Cancel', onPress: cancel }, { text: 'Finish', onPress: finish }]);
  const { id } = getAlert();
  closeWebAlert(id, 1);
  closeWebAlert(id, 1);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});

it('keeps later notifications queued while a confirmation is open', () => {
  showWebAlert('First', 'Confirm first.');
  const first = getAlert().id;
  showWebAlert('Second', 'Confirm next.');
  expect(getAlert().title).toBe('First');
  closeWebAlert(first, 0);
  expect(getAlert().title).toBe('Second');
});
