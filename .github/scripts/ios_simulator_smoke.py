"""Development-only macOS simulator preflight; never an app acceptance test."""
import argparse
import json
import platform
from pathlib import Path
import subprocess


def select_device(listing):
    for runtime, devices in listing.get('devices', {}).items():
        if 'SimRuntime.iOS-' not in runtime:
            continue
        for device in devices:
            if device.get('isAvailable') is True and device.get('name', '').startswith('iPhone'):
                return runtime, device
    raise RuntimeError('No available iPhone simulator runtime')


def command(*args, timeout=60):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if platform.system() != 'Darwin':
        parser.error('Simulator preflight requires macOS/Xcode; no local Windows simulation')
    args.output.mkdir(parents=True, exist_ok=True)
    listing = json.loads(command('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))
    runtime, device = select_device(listing)
    identifier = device['udid']
    if device.get('state') != 'Booted':
        command('xcrun', 'simctl', 'boot', identifier)
    command('xcrun', 'simctl', 'bootstatus', identifier, '-b', timeout=240)
    screenshot = args.output / 'ios-simulator-home.png'
    command('xcrun', 'simctl', 'io', identifier, 'screenshot', str(screenshot))
    if not screenshot.is_file() or screenshot.stat().st_size == 0:
        raise RuntimeError('No simulator screenshot produced')
    report = {
        'scope': 'simulator infrastructure only, no application installed',
        'simulator_booted': True, 'native_app_tested': False,
        'host': platform.platform(), 'xcode': command('xcodebuild', '-version').strip(),
        'runtime': runtime, 'device': device['name'], 'screenshot': screenshot.name,
    }
    (args.output / 'ios-simulator-receipt.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
