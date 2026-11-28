LIMIT = 10

def create(first, second, third, fourth, fifth, sixth)
  first
end

def walk(items)
  if items.any?
    items.each do |item|
      while item > 0
        if item > 1
          item -= 1
        end
      end
    end
  end
  cfg = load(parse(read(open_file)))
  cfg
end
