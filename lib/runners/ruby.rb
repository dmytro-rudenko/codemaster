# Tournament runner for Ruby.
# ruby ruby.rb verify|measure|bytecode <variant> <cases.json> <methodName> <iterations>
# Prints one line "CODEMASTER_RESULT <key> <value>": "passed 1", "failed <reason>", "ns <float>" or "bytecode <count>".
require "json"

def report(key, value)
  puts "CODEMASTER_RESULT #{key} #{value.to_s.split.join(" ")}"
end

def same(actual, expected)
  JSON.parse(JSON.generate([actual])) == [expected]
rescue StandardError
  false
end

begin
  mode, variant_path, cases_path, name, iterations = ARGV
  load File.expand_path(variant_path)
  unless Object.private_method_defined?(name) || Object.method_defined?(name)
    report("failed", "no method #{name}")
    exit 0
  end
  target = method(name)
  parsed = JSON.parse(File.read(cases_path))
  cases = parsed.is_a?(Array) ? parsed : parsed["cases"]
  case mode
  when "bytecode"
    sequence = RubyVM::InstructionSequence.of(target)
    report("bytecode", sequence.to_a.last.count { |item| item.is_a?(Array) })
  when "verify"
    cases.each_with_index do |entry, position|
      begin
        actual = target.call(*entry["input"])
      rescue StandardError => error
        report("failed", "case #{position}: threw #{error.message}")
        exit 0
      end
      unless same(actual, entry["expected"])
        report("failed", "case #{position}: expected #{JSON.generate([entry["expected"]])[1..-2]} got #{actual.inspect}")
        exit 0
      end
    end
    report("passed", 1)
  else
    count = iterations.to_i
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC, :nanosecond)
    count.times { |position| target.call(*cases[position % cases.length]["input"]) }
    report("ns", (Process.clock_gettime(Process::CLOCK_MONOTONIC, :nanosecond) - started).to_f / count)
  end
rescue StandardError, ScriptError => error
  report("failed", error.message)
end
