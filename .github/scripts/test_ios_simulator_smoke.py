"""Pure selector tests using explicitly fictional simulator listings."""
import unittest
from ios_simulator_smoke import select_device


class SelectionTests(unittest.TestCase):
    def test_ignores_unavailable_and_non_ios_devices(self):
        listing = {'devices': {
            'com.apple.CoreSimulator.SimRuntime.tvOS-18-0': [{'name':'iPhone fixture','isAvailable':True}],
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
                {'name':'iPhone unavailable','isAvailable':False},
                {'name':'iPad fixture','isAvailable':True},
                {'name':'iPhone fixture','isAvailable':True,'udid':'fictional'},
            ],
        }}
        runtime, device = select_device(listing)
        self.assertIn('SimRuntime.iOS-', runtime)
        self.assertEqual(device['udid'], 'fictional')

    def test_no_device_is_an_explicit_failure(self):
        with self.assertRaises(RuntimeError):
            select_device({'devices': {}})


if __name__ == '__main__':
    unittest.main()
