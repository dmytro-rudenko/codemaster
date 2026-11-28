# Tournament runner for Python 3.
# python3 python.py verify|measure|bytecode <variant> <cases.json> <functionName> <iterations>
# Prints one line "CODEMASTER_RESULT <key> <value>": "passed 1", "failed <reason>", "ns <float>" or "bytecode <count>".
import asyncio
import dis
import importlib.util
import inspect
import json
import sys
import time


def report(key, value):
    print("CODEMASTER_RESULT %s %s" % (key, " ".join(str(value).split())))


def same(actual, expected):
    if isinstance(expected, bool) or isinstance(actual, bool):
        return isinstance(expected, bool) and isinstance(actual, bool) and actual == expected
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return actual == expected
    if isinstance(expected, list) and isinstance(actual, (list, tuple)):
        return len(actual) == len(expected) and all(same(left, right) for left, right in zip(actual, expected))
    if isinstance(expected, dict) and isinstance(actual, dict):
        return set(map(str, actual)) == set(expected) and all(same(actual[key], expected[str(key)]) for key in actual)
    return type(actual) is type(expected) and actual == expected


def call(function, arguments):
    result = function(*arguments)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
    return result


def main():
    mode, variant_path, cases_path, function_name, iterations = sys.argv[1:6]
    specification = importlib.util.spec_from_file_location("codemaster_variant", variant_path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    function = getattr(module, function_name, None)
    if not callable(function):
        report("failed", "no function %s" % function_name)
        return
    with open(cases_path, encoding="utf-8") as handle:
        parsed = json.load(handle)
    cases = parsed if isinstance(parsed, list) else parsed["cases"]
    if mode == "bytecode":
        report("bytecode", len(list(dis.get_instructions(function))))
        return
    if mode == "verify":
        for position, case in enumerate(cases):
            try:
                actual = call(function, case["input"])
            except Exception as error:
                report("failed", "case %d: threw %s" % (position, error))
                return
            if not same(actual, case["expected"]):
                report("failed", "case %d: expected %s got %r" % (position, json.dumps(case["expected"]), actual))
                return
        report("passed", 1)
        return
    count = int(iterations)
    started = time.perf_counter_ns()
    for position in range(count):
        call(function, cases[position % len(cases)]["input"])
    report("ns", (time.perf_counter_ns() - started) / count)


try:
    main()
except Exception as error:
    report("failed", error)
